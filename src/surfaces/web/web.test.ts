import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { request as httpRequest } from "node:http";
import { makeTestDb } from "../../../test/helpers/db.js";
import type { Db } from "../../db/index.js";
import { MemoryRepo } from "../../memory/repo.js";
import { ActionRegistry } from "../../actions/registry.js";
import { ActionGate } from "../../actions/gate.js";
import { registerBuiltins } from "../../actions/builtin/index.js";
import { Brain } from "../../core/brain.js";
import { FakeRunner } from "../../core/fakeRunner.js";
import { ActivityRepo } from "../../activity/repo.js";
import { JarvisBus } from "../../core/events.js";
import { createApp } from "./index.js";
import type { Express } from "express";
import type { Config } from "../../config.js";

let db: Db;
let app: Express;

beforeEach(async () => {
  db = await makeTestDb();
  const memory = new MemoryRepo(db);
  await memory.ensureUser("colt", "Colt");
  await memory.ensureUser("rich", "Rich");
  const registry = new ActionRegistry();
  registerBuiltins(registry, { memory, db });
  const gate = new ActionGate(db, registry);
  const activity = new ActivityRepo(db);
  const { SettingsRepo } = await import("../../settings/repo.js");
  const settings = new SettingsRepo(db);
  const bus = new JarvisBus();
  const cfg: Pick<Config, "tz" | "workspaceDir"> = {
    tz: "America/Denver",
    workspaceDir: "./workspace",
  };
  const brain = new Brain({
    memory,
    gate,
    registry,
    runner: new FakeRunner([{ say: "hi from jarvis" }]),
    config: cfg,
    bus,
    activity,
  });
  app = createApp({
    users: [
      {
        id: "colt", name: "Colt", password: "hunter2", telegramId: null, persona: "",
        theme: { mode: "hud", accent: null, background: null, backgroundFit: "watermark", brand: null, logo: null },
      },
      {
        id: "rich", name: "Rich", password: "richpw", telegramId: null, persona: "",
        theme: { mode: "light", accent: "#1a5aa0", background: null, backgroundFit: "watermark", brand: "Peterson Sales", logo: null },
      },
    ],
    sessionSecret: "x".repeat(32),
    databaseUrl: null,
    tz: "America/New_York",
    model: "claude-sonnet-5",
    brain,
    gate,
    memory,
    activity,
    settings,
    settingDefaults: {},
    bus,
    db,
    publicUrl: "http://localhost",
  });
});
afterEach(async () => {
  await db.close();
});

type CallResult = { status: number; body: Record<string, unknown>; cookie?: string };

function call(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; form?: string; headers?: Record<string, string> } = {}
): Promise<CallResult> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const data = opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined);
      const contentType = opts.form
        ? "application/x-www-form-urlencoded"
        : "application/json";
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            "content-type": contentType,
            ...(data ? { "content-length": Buffer.byteLength(data) } : {}),
            ...(opts.cookie ? { cookie: opts.cookie } : {}),
            ...(opts.headers ?? {}),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            server.close();
            const setCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(raw);
            } catch {
              /* html response, ignore */
            }
            resolve({ status: res.statusCode ?? 0, body: parsed, cookie: setCookie });
          });
        }
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  });
}

describe("WebSurface", () => {
  it("blocks /api/message without a session", async () => {
    const res = await call("POST", "/api/message", { body: { text: "hi" } });
    expect(res.status).toBe(401);
  });

  it("logs in and gets a reply", async () => {
    const login = await call("POST", "/login", { body: { password: "hunter2" } });
    expect(login.status).toBe(200);
    const res = await call("POST", "/api/message", { cookie: login.cookie, body: { text: "hi" } });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("hi from jarvis");
  });

  it("rejects a wrong password", async () => {
    const res = await call("POST", "/login", { body: { password: "nope" } });
    expect(res.status).toBe(401);
  });

  it("serves /health unauthenticated", async () => {
    const res = await call("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("blocks /api/overview without a session and returns a snapshot with one", async () => {
    const blocked = await call("GET", "/api/overview");
    expect(blocked.status).toBe(401);

    const login = await call("POST", "/login", { body: { password: "hunter2" } });
    await call("POST", "/api/message", { cookie: login.cookie, body: { text: "hello" } });
    const res = await call("GET", "/api/overview", { cookie: login.cookie });
    expect(res.status).toBe(200);
    expect(res.body.model).toBe("claude-sonnet-5");
    expect(Array.isArray(res.body.pending)).toBe(true);
    expect(Array.isArray(res.body.memories)).toBe(true);
    expect(Array.isArray(res.body.activity)).toBe(true);
    // the message turn should have produced activity rows
    expect((res.body.activity as unknown[]).length).toBeGreaterThan(0);
  });

  it("serves an empty settings payload (mechanism kept, no keys yet)", async () => {
    const login = await call("POST", "/login", { body: { password: "hunter2" } });
    const res = await call("GET", "/api/settings", { cookie: login.cookie });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({});
  });

  it("greets the user by name on login", async () => {
    const colt = await call("POST", "/login", { body: { password: "hunter2" } });
    expect(colt.body.message).toBe("Hello Colt!");
    const rich = await call("POST", "/login", { body: { password: "richpw" } });
    expect(rich.body.message).toBe("Hello Rich!");
  });

  it("keeps each user's data separate", async () => {
    const colt = await call("POST", "/login", { body: { password: "hunter2" } });
    await call("POST", "/api/message", { cookie: colt.cookie, body: { text: "hi from colt" } });
    const rich = await call("POST", "/login", { body: { password: "richpw" } });
    const me = await call("GET", "/api/me", { cookie: rich.cookie });
    expect(me.body.name).toBe("Rich");
    const richView = await call("GET", "/api/overview", { cookie: rich.cookie });
    // Rich has no messages yet — Colt's turn must not show up for Rich
    expect((richView.body.messages as unknown[]).length).toBe(0);
    const coltView = await call("GET", "/api/overview", { cookie: colt.cookie });
    expect((coltView.body.messages as unknown[]).length).toBeGreaterThan(0);
  });
});
