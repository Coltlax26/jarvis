import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "../memory/repo.js";
import { ActionRegistry } from "./registry.js";
import { ActionGate } from "./gate.js";
import type { Action } from "./types.js";

let db: Db;
let gate: ActionGate;
const ran: string[] = [];

function makeAction(name: string, tier: 0 | 1 | 2): Action<{ text: string }> {
  return {
    name,
    tier,
    description: `test ${name}`,
    schema: z.object({ text: z.string() }),
    summarize: (i) => `${name}: ${i.text}`,
    run: async (i) => {
      ran.push(`${name}:${i.text}`);
      return { ok: true, message: `did ${name}` };
    },
  };
}

beforeEach(async () => {
  ran.length = 0;
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
  const reg = new ActionRegistry();
  reg.register(makeAction("note", 0) as Action);
  reg.register(makeAction("dm", 1) as Action);
  reg.register(makeAction("buy", 2) as Action);
  gate = new ActionGate(db, reg);
});
afterEach(async () => {
  await db.close();
});

const ctx = { userId: "colt", originSurface: "web" };

describe("ActionGate", () => {
  it("runs tier 0 immediately", async () => {
    const out = await gate.attempt("note", { text: "hi" }, ctx);
    expect(out.kind).toBe("executed");
    expect(ran).toEqual(["note:hi"]);
  });

  it("holds tier 1 as draft without running", async () => {
    const out = await gate.attempt("dm", { text: "hey bob" }, ctx);
    expect(out.kind).toBe("held");
    expect(ran).toEqual([]);
    const pending = await gate.listPending("colt");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe("draft");
  });

  it("holds tier 2 as awaiting_approval", async () => {
    const out = await gate.attempt("buy", { text: "tickets" }, ctx);
    expect(out.kind).toBe("held");
    const pending = await gate.listPending("colt");
    expect(pending[0]!.status).toBe("awaiting_approval");
  });

  it("runs the action on approve and marks it done", async () => {
    const out = await gate.attempt("buy", { text: "tickets" }, ctx);
    if (out.kind !== "held") throw new Error("expected held");
    const res = await gate.approve(out.pendingId, "colt");
    expect(res.ok).toBe(true);
    expect(ran).toEqual(["buy:tickets"]);
    const pending = await gate.listPending("colt");
    expect(pending).toHaveLength(0);
  });

  it("does not run the action on reject", async () => {
    const out = await gate.attempt("dm", { text: "x" }, ctx);
    if (out.kind !== "held") throw new Error("expected held");
    await gate.reject(out.pendingId, "colt");
    expect(ran).toEqual([]);
    await expect(gate.approve(out.pendingId, "colt")).rejects.toThrow();
  });

  it("rejects unknown actions and bad input", async () => {
    expect((await gate.attempt("nope", {}, ctx)).kind).toBe("rejected");
    expect((await gate.attempt("note", { text: 5 }, ctx)).kind).toBe("rejected");
  });

  it("refuses cross-user approval", async () => {
    const out = await gate.attempt("buy", { text: "y" }, ctx);
    if (out.kind !== "held") throw new Error("expected held");
    await expect(gate.approve(out.pendingId, "someone-else")).rejects.toThrow();
  });
});
