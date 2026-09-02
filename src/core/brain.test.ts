import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "../memory/repo.js";
import { ActionRegistry } from "../actions/registry.js";
import { ActionGate } from "../actions/gate.js";
import { registerBuiltins } from "../actions/builtin/index.js";
import { Brain } from "./brain.js";
import { FakeRunner } from "./fakeRunner.js";
import type { Config } from "../config.js";

let db: Db;
let memory: MemoryRepo;
let gate: ActionGate;
let registry: ActionRegistry;

beforeEach(async () => {
  db = await makeTestDb();
  memory = new MemoryRepo(db);
  await memory.ensureUser("colt", "Colt");
  registry = new ActionRegistry();
  registerBuiltins(registry, { memory, db });
  gate = new ActionGate(db, registry);
});
afterEach(async () => {
  await db.close();
});

const cfg: Pick<Config, "tz" | "workspaceDir"> = {
  tz: "America/Denver",
  workspaceDir: "./workspace",
};

describe("Brain", () => {
  it("answers and persists both sides of the turn", async () => {
    const runner = new FakeRunner([{ say: "Hello Colt." }]);
    const brain = new Brain({ memory, gate, registry, runner, config: cfg });
    const out = await brain.handle({ userId: "colt", surface: "web", text: "hi" });
    expect(out.text).toBe("Hello Colt.");
    const conv = await memory.getOrCreateConversation("colt");
    const msgs = await memory.recentMessages(conv, 10);
    expect(msgs.map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:hi",
      "assistant:Hello Colt.",
    ]);
  });

  it("shares history across surfaces", async () => {
    const b1 = new Brain({
      memory,
      gate,
      registry,
      runner: new FakeRunner([{ say: "noted" }]),
      config: cfg,
    });
    await b1.handle({ userId: "colt", surface: "telegram", text: "my cat is Milo" });
    const capturing = new FakeRunner([{ say: "" }]);
    const b2 = new Brain({ memory, gate, registry, runner: capturing, config: cfg });
    await b2.handle({ userId: "colt", surface: "web", text: "what's my cat's name?" });
    expect(capturing.lastUserPrompt).toContain("my cat is Milo");
  });

  it("runs a tier 0 tool call through the gate", async () => {
    const runner = new FakeRunner([
      { callTool: { name: "remember", input: { content: "Colt's cat is Milo" } }, say: "Got it." },
    ]);
    const brain = new Brain({ memory, gate, registry, runner, config: cfg });
    await brain.handle({ userId: "colt", surface: "web", text: "remember my cat is Milo" });
    const hits = await memory.searchMemories("colt", "cat name", 5);
    expect(hits.some((m) => m.content.includes("Milo"))).toBe(true);
  });

  it("feeds a tier 0 action's output back to the model", async () => {
    const runner = new FakeRunner([
      { callTool: { name: "set_reminder", input: { deliverAt: new Date(Date.now() + 3.6e6).toISOString(), body: "call mom" } }, say: "Done." },
    ]);
    const brain = new Brain({ memory, gate, registry, runner, config: cfg });
    await brain.handle({ userId: "colt", surface: "web", text: "remind me to call mom in an hour" });
    expect(runner.toolResults[0]).toMatch(/Reminder set/i);
  });

  it("denies a tier 2 tool call and tells the model it is pending", async () => {
    const seen: string[] = [];
    const runner = new FakeRunner([
      {
        callTool: { name: "spend_test", input: { amountUsd: 5, note: "x" } },
        say: "I asked for approval.",
      },
    ]);
    runner.onDeny = (m) => seen.push(m);
    const brain = new Brain({ memory, gate, registry, runner, config: cfg });
    await brain.handle({ userId: "colt", surface: "web", text: "buy x" });
    expect(seen[0]).toMatch(/approval/i);
    const pending = await gate.listPending("colt");
    expect(pending).toHaveLength(1);
  });
});
