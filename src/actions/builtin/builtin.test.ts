import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../../test/helpers/db.js";
import type { Db } from "../../db/index.js";
import { MemoryRepo } from "../../memory/repo.js";
import { ActionRegistry } from "../registry.js";
import { ActionGate } from "../gate.js";
import { registerBuiltins } from "./index.js";

let db: Db;
let gate: ActionGate;
let memory: MemoryRepo;

beforeEach(async () => {
  db = await makeTestDb();
  memory = new MemoryRepo(db);
  await memory.ensureUser("colt", "Colt");
  const reg = new ActionRegistry();
  registerBuiltins(reg, { memory, db });
  gate = new ActionGate(db, reg);
});
afterEach(async () => {
  await db.close();
});

const ctx = { userId: "colt", originSurface: "web" };

describe("builtin actions", () => {
  it("remember stores a retrievable memory", async () => {
    const out = await gate.attempt(
      "remember",
      { content: "Colt's car is a blue Civic" },
      ctx
    );
    expect(out.kind).toBe("executed");
    const hits = await memory.searchMemories("colt", "what car do I drive", 5);
    expect(hits.some((m) => m.content.includes("Civic"))).toBe(true);
  });

  it("set_reminder inserts a pending scheduled message", async () => {
    const when = new Date(Date.now() + 3600_000).toISOString();
    await gate.attempt("set_reminder", { deliverAt: when, body: "call mom" }, ctx);
    const { rows } = await db.query<{ body: string; status: string }>(
      `select body, status from scheduled_messages`
    );
    expect(rows[0]).toMatchObject({ body: "call mom", status: "pending" });
  });

  it("send_test_message is tier 1 (held, not run)", async () => {
    const out = await gate.attempt(
      "send_test_message",
      { to: "bob", text: "hi" },
      ctx
    );
    expect(out.kind).toBe("held");
    if (out.kind === "held") expect(out.tier).toBe(1);
  });

  it("spend_test is tier 2", async () => {
    const out = await gate.attempt(
      "spend_test",
      { amountUsd: 10, note: "dinner" },
      ctx
    );
    expect(out.kind).toBe("held");
    if (out.kind === "held") expect(out.tier).toBe(2);
  });

  it("place_call is tier 2 and normalises the number on approval", async () => {
    const calls: { to: string; purpose: string; ownerId: string }[] = [];
    const reg = new ActionRegistry();
    registerBuiltins(reg, {
      memory,
      db,
      placeOutbound: async (input) => {
        calls.push(input);
        return { id: "call-1" };
      },
    });
    const g = new ActionGate(db, reg);
    const held = await g.attempt(
      "place_call",
      { to: "(610) 555-0000", purpose: "book a table for two at 7" },
      ctx
    );
    expect(held.kind).toBe("held");
    if (held.kind !== "held") return;
    expect(held.tier).toBe(2);
    expect(calls).toHaveLength(0); // not run until approved

    const res = await g.approve(held.pendingId, "colt");
    expect(res.ok).toBe(true);
    expect(calls[0]).toEqual({
      to: "+16105550000",
      purpose: "book a table for two at 7",
      ownerId: "colt",
    });
  });

  it("place_call reports cleanly when outbound calling is not configured", async () => {
    const held = await gate.attempt(
      "place_call",
      { to: "+16105550000", purpose: "ask about hours" },
      ctx
    );
    expect(held.kind).toBe("held");
    if (held.kind !== "held") return;
    const res = await gate.approve(held.pendingId, "colt");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not configured/i);
  });
});
