import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import session, { type Store } from "express-session";
import connectPgSimple from "connect-pg-simple";
import { logger } from "../../logger.js";
import type { JarvisUser } from "../../config.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { MemoryRepo } from "../../memory/repo.js";
import type { ActivityRepo } from "../../activity/repo.js";
import { SETTING_KEYS, type SettingsRepo } from "../../settings/repo.js";
import type { JarvisBus } from "../../core/events.js";
import type { Db } from "../../db/index.js";
import type { Surface } from "../types.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");

export type SmsHook = {
  webhookUrl: string;
  verify(signature: string | undefined, url: string, params: Record<string, string>): boolean;
  userForPhone(from: string): string | undefined;
  handleInbound(from: string, body: string): Promise<void>;
};

export type VoiceHook = {
  incomingUrl: string;
  turnUrl: string;
  announceUrl: string;
  statusUrl: string;
  verify(signature: string | undefined, url: string, params: Record<string, string>): boolean;
  greeting(from: string, callSid: string): Promise<string>;
  turn(from: string, speech: string, callSid: string): Promise<string>;
  callStatus(callSid: string, status: string): void;
  announcementFor(token: string): Promise<string>;
  /** mp3 bytes for a generated ElevenLabs line, or null if unknown/expired. */
  audioFor(id: string): Buffer | null;
  activeCalls(): { userId: string; name: string; sinceMs: number }[];
  /** Outbound calls (Tier-2 place_call action). */
  outbound?: {
    incomingUrl: string;
    turnUrl: string;
    statusUrl: string;
    greeting(id: string, callSid: string): Promise<string>;
    turn(id: string, callSid: string, speech: string): Promise<string>;
    status(id: string, status: string): Promise<void>;
    history(ownerId: string): Promise<
      {
        id: string;
        counterparty: string;
        purpose: string;
        status: string;
        transcript: { speaker: string; text: string }[];
        createdAt: Date;
      }[]
    >;
  };
};

type Deps = {
  users: JarvisUser[];
  sessionSecret: string;
  publicUrl: string;
  databaseUrl: string | null;
  tz: string;
  brain: Brain;
  gate: ActionGate;
  memory: MemoryRepo;
  activity: ActivityRepo;
  settings: SettingsRepo;
  bus: JarvisBus;
  db: Db;
  /** Env-var defaults, shown in the Settings tab when nothing is overridden. */
  settingDefaults: Record<string, string>;
  sms?: SmsHook;
  voice?: VoiceHook;
  google?: GoogleHook;
  browseShot?: (id: string) => Buffer | null;
};

export type GoogleHook = {
  authUrl(state: string): string;
  connect(userId: string, code: string): Promise<void>;
  isConnected(userId: string): Promise<boolean>;
  disconnect(userId: string): Promise<void>;
};

type SessionShape = { userId?: string; googleState?: string };

export function createApp(deps: Deps): Express {
  const app = express();
  const behindProxy = deps.publicUrl.startsWith("https");
  // Railway (and most PaaS) terminate TLS at a proxy and forward plain HTTP.
  // Without trusting the proxy, express-session sees an insecure connection and
  // refuses to set a `secure` cookie — so the session never sticks and the user
  // bounces straight back to the login screen.
  if (behindProxy) app.set("trust proxy", 1);
  app.use(express.json());

  // Persist sessions in Postgres in production so logins survive redeploys.
  // Locally / in tests (no DATABASE_URL) fall back to the in-memory store.
  let store: Store | undefined;
  if (deps.databaseUrl) {
    const PgStore = connectPgSimple(session);
    store = new PgStore({
      conString: deps.databaseUrl,
      tableName: "session",
      createTableIfMissing: true,
    });
  }

  app.use(
    session({
      store,
      secret: deps.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: behindProxy,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  const byId = new Map(deps.users.map((u) => [u.id, u]));
  const uid = (req: Request): string => (req.session as SessionShape).userId ?? "";

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const id = uid(req);
    if (id && byId.has(id)) return next();
    res.status(401).json({ error: "not authenticated" });
  };

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/login", (req, res) => {
    const password = String(req.body?.password ?? "");
    const user = deps.users.find((u) => u.password === password);
    if (!user) return res.status(401).json({ error: "Wrong password" });
    (req.session as SessionShape).userId = user.id;
    res.json({ ok: true, message: `Hello ${user.name}!`, user: { id: user.id, name: user.name } });
  });

  app.post("/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/me", (req, res) => {
    const user = byId.get(uid(req));
    if (!user) return res.status(401).json({ error: "not authenticated" });
    res.json({ id: user.id, name: user.name, theme: user.theme, tz: deps.tz });
  });

  app.post("/api/message", requireAuth, async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "empty" });
    try {
      const out = await deps.brain.handle({ userId: uid(req), surface: "web", text });
      res.json({ reply: out.text });
    } catch (err) {
      logger.error("web message failed", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/overview", requireAuth, async (req, res) => {
    const userId = uid(req);
    try {
      const conversationId = await deps.memory.getOrCreateConversation(userId);
      const [pending, reminders, memories, activity, messages] = await Promise.all([
        deps.gate.listPending(userId),
        listReminders(deps.db, userId),
        deps.memory.listMemories(userId, 100),
        deps.activity.recent(userId, 60),
        deps.memory.recentMessages(conversationId, 60),
      ]);
      const now = new Date();
      const todayStr = now.toLocaleDateString("en-CA", { timeZone: deps.tz });
      const remindersToday = reminders.filter(
        (r) => new Date(r.deliverAt).toLocaleDateString("en-CA", { timeZone: deps.tz }) === todayStr
      );
      res.json({
        status: pending.length ? "waiting_on_you" : "idle",
        pending,
        reminders,
        memories,
        activity,
        messages,
        model: "claude-opus-5",
        now: now.toISOString(),
        tz: deps.tz,
        today: {
          date: now.toLocaleDateString("en-US", {
            timeZone: deps.tz,
            weekday: "long",
            month: "long",
            day: "numeric",
          }),
          reminders: remindersToday,
          pendingCount: pending.length,
        },
      });
    } catch (err) {
      logger.error("overview failed", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/pending/:id/approve", requireAuth, async (req, res) => {
    const userId = uid(req);
    try {
      const r = await deps.gate.approve(String(req.params.id), userId);
      await deps.activity.log({
        userId,
        kind: "action_approved",
        summary: `Approved ${String(req.params.id).slice(0, 8)} — ${r.message}`,
      });
      res.json(r);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  app.post("/api/pending/:id/reject", requireAuth, async (req, res) => {
    const userId = uid(req);
    try {
      await deps.gate.reject(String(req.params.id), userId);
      await deps.activity.log({
        userId,
        kind: "action_rejected",
        summary: `Rejected ${String(req.params.id).slice(0, 8)}`,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Server-sent events: live turn progress for the logged-in user.
  app.get("/api/stream", requireAuth, (req, res) => {
    const userId = uid(req);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    res.write(`event: hello\ndata: {"ok":true}\n\n`);

    const unsubscribe = deps.bus.subscribe(userId, (event) => {
      res.write(`event: activity\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const ping = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), 25_000);

    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.get("/api/settings", requireAuth, async (req, res) => {
    const userId = uid(req);
    const stored = await deps.settings.all(userId);
    const out: Record<string, { value: string; default: string; overridden: boolean }> = {};
    for (const key of SETTING_KEYS) {
      const def = deps.settingDefaults[key] ?? "";
      out[key] = {
        value: stored[key] ?? def,
        default: def,
        overridden: key in stored,
      };
    }
    res.json({ settings: out, keys: SETTING_KEYS });
  });

  app.put("/api/settings", requireAuth, async (req, res) => {
    const userId = uid(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, string> = {};
    for (const key of SETTING_KEYS) {
      if (key in body) updates[key] = String(body[key] ?? "");
    }
    await deps.settings.setMany(userId, updates);
    res.json({ ok: true });
  });

  app.get("/api/voice", requireAuth, async (req, res) => {
    const userId = uid(req);
    const active = (deps.voice?.activeCalls() ?? []).filter((c) => c.userId === userId);
    const calls = (await deps.activity.recent(userId, 60)).filter((a) =>
      ["call_started", "call_ended"].includes(a.kind)
    );
    const outbound = (await deps.voice?.outbound?.history(userId)) ?? [];
    res.json({ enabled: Boolean(deps.voice), active, calls, outbound });
  });

  // Google (Gmail + Calendar) connect flow.
  if (deps.google) {
    const g = deps.google;
    app.get("/api/google", requireAuth, async (req, res) => {
      res.json({ available: true, connected: await g.isConnected(uid(req)) });
    });
    app.get("/auth/google", requireAuth, (req, res) => {
      const state = randomUUID();
      (req.session as SessionShape).googleState = state;
      res.redirect(g.authUrl(state));
    });
    app.get("/auth/google/callback", requireAuth, async (req, res) => {
      const sess = req.session as SessionShape;
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      if (!code || !state || state !== sess.googleState) {
        return res.redirect("/?google=error");
      }
      delete sess.googleState;
      try {
        await g.connect(uid(req), code);
        res.redirect("/?google=connected");
      } catch (err) {
        logger.error("google connect failed", err);
        res.redirect("/?google=error");
      }
    });
    app.post("/api/google/disconnect", requireAuth, async (req, res) => {
      await g.disconnect(uid(req));
      res.json({ ok: true });
    });
  } else {
    app.get("/api/google", requireAuth, (_req, res) =>
      res.json({ available: false, connected: false })
    );
  }

  // Twilio inbound SMS webhook (form-encoded, no session).
  if (deps.sms) {
    const sms = deps.sms;
    app.post(
      "/twilio/sms",
      express.urlencoded({ extended: false }),
      (req, res) => {
        const params = (req.body ?? {}) as Record<string, string>;
        if (!sms.verify(req.header("X-Twilio-Signature"), sms.webhookUrl, params)) {
          logger.warn("rejected twilio webhook: bad signature");
          return res.status(403).send("bad signature");
        }
        const from = String(params.From ?? "");
        const body = String(params.Body ?? "").trim();
        res.set("Content-Type", "text/xml").send("<Response></Response>");
        if (from && body && sms.userForPhone(from)) {
          void sms.handleInbound(from, body);
        } else if (from && !sms.userForPhone(from)) {
          logger.warn("sms from unknown number", { from });
        }
      }
    );
  }

  // Twilio Voice webhooks.
  if (deps.voice) {
    const voice = deps.voice;
    const form = express.urlencoded({ extended: false });
    const xml = (res: Response, doc: string) =>
      res.set("Content-Type", "text/xml").send(doc);

    app.post("/twilio/voice", form, async (req, res) => {
      const params = (req.body ?? {}) as Record<string, string>;
      if (!voice.verify(req.header("X-Twilio-Signature"), voice.incomingUrl, params)) {
        logger.warn("rejected twilio voice webhook: bad signature");
        return res.status(403).send("bad signature");
      }
      try {
        xml(
          res,
          await voice.greeting(String(params.From ?? ""), String(params.CallSid ?? ""))
        );
      } catch (err) {
        logger.error("voice greeting failed", err);
        xml(
          res,
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Jarvis is briefly unavailable. Please call back.</Say><Hangup/></Response>'
        );
      }
    });

    app.post("/twilio/voice/turn", form, async (req, res) => {
      const params = (req.body ?? {}) as Record<string, string>;
      if (!voice.verify(req.header("X-Twilio-Signature"), voice.turnUrl, params)) {
        logger.warn("rejected twilio voice turn: bad signature");
        return res.status(403).send("bad signature");
      }
      try {
        const doc = await voice.turn(
          String(params.From ?? ""),
          String(params.SpeechResult ?? ""),
          String(params.CallSid ?? "")
        );
        xml(res, doc);
      } catch (err) {
        logger.error("voice turn route failed", err);
        xml(
          res,
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Something went wrong. Goodbye.</Say><Hangup/></Response>'
        );
      }
    });

    app.post("/twilio/voice/status", form, (req, res) => {
      const params = (req.body ?? {}) as Record<string, string>;
      if (!voice.verify(req.header("X-Twilio-Signature"), voice.statusUrl, params)) {
        return res.status(403).send("bad signature");
      }
      voice.callStatus(String(params.CallSid ?? ""), String(params.CallStatus ?? ""));
      res.status(204).end();
    });

    app.post("/twilio/voice/announce", form, async (req, res) => {
      const params = (req.body ?? {}) as Record<string, string>;
      const token = String(req.query.t ?? "");
      const fullUrl = `${voice.announceUrl}?t=${token}`;
      if (!voice.verify(req.header("X-Twilio-Signature"), fullUrl, params)) {
        logger.warn("rejected twilio announce: bad signature");
        return res.status(403).send("bad signature");
      }
      xml(res, await voice.announcementFor(token));
    });

    // Outbound calls (Tier-2 place_call). `c` is our voice_calls id.
    if (voice.outbound) {
      const ob = voice.outbound;
      app.post("/twilio/voice/outbound", form, async (req, res) => {
        const params = (req.body ?? {}) as Record<string, string>;
        const id = String(req.query.c ?? "");
        if (!voice.verify(req.header("X-Twilio-Signature"), `${ob.incomingUrl}?c=${id}`, params)) {
          return res.status(403).send("bad signature");
        }
        try {
          xml(res, await ob.greeting(id, String(params.CallSid ?? "")));
        } catch (err) {
          logger.error("outbound greeting failed", err);
          xml(res, '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
        }
      });

      app.post("/twilio/voice/outbound/turn", form, async (req, res) => {
        const params = (req.body ?? {}) as Record<string, string>;
        const id = String(req.query.c ?? "");
        if (!voice.verify(req.header("X-Twilio-Signature"), `${ob.turnUrl}?c=${id}`, params)) {
          return res.status(403).send("bad signature");
        }
        try {
          xml(
            res,
            await ob.turn(id, String(params.CallSid ?? ""), String(params.SpeechResult ?? ""))
          );
        } catch (err) {
          logger.error("outbound turn failed", err);
          xml(res, '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
        }
      });

      app.post("/twilio/voice/outbound/status", form, async (req, res) => {
        const params = (req.body ?? {}) as Record<string, string>;
        const id = String(req.query.c ?? "");
        if (!voice.verify(req.header("X-Twilio-Signature"), `${ob.statusUrl}?c=${id}`, params)) {
          return res.status(403).send("bad signature");
        }
        await ob.status(id, String(params.CallStatus ?? ""));
        res.status(204).end();
      });
    }

    // Generated ElevenLabs audio, fetched by Twilio's <Play>. Unguessable id,
    // short TTL, no signature (Twilio's media fetcher doesn't sign GETs).
    app.get("/voice/audio/:id", (req, res) => {
      const id = String(req.params.id ?? "").replace(/\.mp3$/, "");
      const mp3 = voice.audioFor(id);
      if (!mp3) return res.status(404).end();
      res.set("Content-Type", "audio/mpeg").send(mp3);
    });
  }

  if (deps.browseShot) {
    app.get("/browse/shot/:id", requireAuth, (req, res) => {
      const id = String(req.params.id ?? "").replace(/\.png$/, "");
      const png = deps.browseShot!(id);
      if (!png) return res.status(404).end();
      res.set("Content-Type", "image/png").send(png);
    });
  }

  app.use(express.static(publicDir));
  app.get("/", (_req, res) => res.sendFile(join(publicDir, "index.html")));

  return app;
}

async function listReminders(db: Db, userId: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `select id, deliver_at, body, source, status from scheduled_messages
     where user_id = $1 and status = 'pending'
     order by deliver_at asc limit 50`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id as string,
    deliverAt: new Date(r.deliver_at as string).toISOString(),
    body: r.body as string,
    source: r.source as string,
    status: r.status as string,
  }));
}

export class WebSurface implements Surface {
  readonly name = "web";
  private app: Express;
  private server: Server | null = null;

  constructor(private opts: Deps & { port: number }) {
    this.app = createApp(opts);
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server = createServer(this.app).listen(this.opts.port, () => {
        logger.info("web surface listening", { port: this.opts.port });
        resolve();
      });
    });
  }
  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
  async send(userId: string, text: string): Promise<void> {
    this.opts.bus.publish(userId, {
      kind: "turn_end",
      text,
      at: new Date().toISOString(),
      surface: "scheduler",
    });
  }
}
