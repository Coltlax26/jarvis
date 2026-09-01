import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import { logger } from "../../logger.js";
import type { JarvisUser } from "../../config.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { MemoryRepo } from "../../memory/repo.js";
import type { ActivityRepo } from "../../activity/repo.js";
import type { JarvisBus } from "../../core/events.js";
import type { Db } from "../../db/index.js";
import type { Surface } from "../types.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");

type Deps = {
  users: JarvisUser[];
  sessionSecret: string;
  publicUrl: string;
  brain: Brain;
  gate: ActionGate;
  memory: MemoryRepo;
  activity: ActivityRepo;
  bus: JarvisBus;
  db: Db;
};

type SessionShape = { userId?: string };

export function createApp(deps: Deps): Express {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: deps.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax", secure: deps.publicUrl.startsWith("https") },
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
    res.json({ id: user.id, name: user.name });
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
      res.json({
        status: pending.length ? "waiting_on_you" : "idle",
        pending,
        reminders,
        memories,
        activity,
        messages,
        model: "claude-opus-5",
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
