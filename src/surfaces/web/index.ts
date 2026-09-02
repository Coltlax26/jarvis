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

type Deps = {
  users: JarvisUser[];
  sessionSecret: string;
  publicUrl: string;
  databaseUrl: string | null;
  tz: string;
  /** Main model name, surfaced in the console overview. */
  model?: string;
  brain: Brain;
  gate: ActionGate;
  memory: MemoryRepo;
  activity: ActivityRepo;
  settings: SettingsRepo;
  bus: JarvisBus;
  db: Db;
  /** Env-var defaults, shown in the Settings tab when nothing is overridden. */
  settingDefaults: Record<string, string>;
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
        model: deps.model ?? "claude-haiku-4-5",
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
    const stored = await deps.settings.all(uid(req));
    const out: Record<string, { value: string; default: string; overridden: boolean }> = {};
    for (const key of SETTING_KEYS as readonly string[]) {
      const def = deps.settingDefaults[key] ?? "";
      out[key] = { value: stored[key] ?? def, default: def, overridden: key in stored };
    }
    res.json({ settings: out, keys: SETTING_KEYS });
  });

  app.put("/api/settings", requireAuth, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, string> = {};
    for (const key of SETTING_KEYS as readonly string[]) {
      if (key in body) updates[key] = String(body[key] ?? "");
    }
    await deps.settings.setMany(uid(req), updates);
    res.json({ ok: true });
  });

  // Brain tab: the facts Jarvis remembers + live standing instructions.
  app.get("/api/brain", requireAuth, async (req, res) => {
    const userId = uid(req);
    const [memories, instructions] = await Promise.all([
      deps.memory.listMemories(userId, 300),
      deps.settings.get(userId, "instructions", ""),
    ]);
    res.json({
      memories: memories.map((m) => ({
        id: m.id,
        content: m.content,
        source: m.source,
        createdAt: m.createdAt,
      })),
      instructions,
    });
  });

  app.post("/api/brain/memory", requireAuth, async (req, res) => {
    const content = String((req.body as { content?: unknown })?.content ?? "").trim();
    if (content.length < 3) return res.status(400).json({ error: "too short" });
    const m = await deps.memory.addMemory({
      userId: uid(req),
      content: content.slice(0, 2000),
      source: "console",
    });
    res.json({ ok: true, id: m.id });
  });

  app.delete("/api/brain/memory/:id", requireAuth, async (req, res) => {
    const ok = await deps.memory.deleteMemory(uid(req), String(req.params.id));
    res.status(ok ? 200 : 404).json({ ok });
  });

  app.put("/api/brain/instructions", requireAuth, async (req, res) => {
    const text = String((req.body as { text?: unknown })?.text ?? "").slice(0, 4000);
    await deps.settings.set(uid(req), "instructions", text);
    res.json({ ok: true });
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
