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
import { createApp } from "./index.js";
import type { Express } from "express";
import type { Config } from "../../config.js";

let db: Db;
let app: Express;

beforeEach(async () => {
  db = await makeTestDb();
  const memory = new MemoryRepo(db);
  await memory.ensureUser("colt", "Colt");
  const registry = new ActionRegistry();
  registerBuiltins(registry, { memory, db });
  const gate = new ActionGate(db, registry);
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
  });
  app = createApp({
    password: "hunter2",
    sessionSecret: "x".repeat(32),
    userId: "colt",
    brain,
    gate,
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
  opts: { cookie?: string; body?: unknown } = {}
): Promise<CallResult> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const data = opts.body ? JSON.stringify(opts.body) : undefined;
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            "content-type": "application/json",
            ...(data ? { "content-length": Buffer.byteLength(data) } : {}),
            ...(opts.cookie ? { cookie: opts.cookie } : {}),
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
});
