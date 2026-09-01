import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import { logger } from "../../logger.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { Surface } from "../types.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");

type Deps = {
  password: string;
  sessionSecret: string;
  userId: string;
  brain: Brain;
  gate: ActionGate;
  publicUrl: string;
};

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

  const inbox: string[] = [];

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if ((req.session as { authed?: boolean }).authed) return next();
    res.status(401).json({ error: "not authenticated" });
  };

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/login", (req, res) => {
    if (req.body?.password === deps.password) {
      (req.session as { authed?: boolean }).authed = true;
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: "wrong password" });
    }
  });

  app.post("/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.post("/api/message", requireAuth, async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "empty" });
    try {
      const out = await deps.brain.handle({ userId: deps.userId, surface: "web", text });
      res.json({ reply: out.text });
    } catch (err) {
      logger.error("web message failed", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/pending", requireAuth, async (_req, res) => {
    res.json({ pending: await deps.gate.listPending(deps.userId) });
  });
  app.post("/api/pending/:id/approve", requireAuth, async (req, res) => {
    try {
      const r = await deps.gate.approve(String(req.params.id), deps.userId);
      res.json(r);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  app.post("/api/pending/:id/reject", requireAuth, async (req, res) => {
    try {
      await deps.gate.reject(String(req.params.id), deps.userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/api/inbox", requireAuth, (_req, res) => {
    const items = inbox.splice(0, inbox.length);
    res.json({ items });
  });

  app.use(express.static(publicDir));
  app.get("/", (_req, res) => res.sendFile(join(publicDir, "index.html")));

  // expose the inbox to the Surface wrapper
  (app as unknown as { _inbox: string[] })._inbox = inbox;
  return app;
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
  async send(_userId: string, text: string): Promise<void> {
    (this.app as unknown as { _inbox: string[] })._inbox.push(text);
  }
}
