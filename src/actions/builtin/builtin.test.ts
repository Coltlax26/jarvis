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

  it("mac actions register when a mac api is given, are tier 0, and open things", async () => {
    const opened: string[] = [];
    const reg = new ActionRegistry();
    registerBuiltins(reg, {
      memory,
      db,
      mac: {
        openUrl: async (u) => {
          opened.push(`url:${u}`);
        },
        openApp: async (n) => {
          opened.push(`app:${n}`);
        },
      },
    });
    const g = new ActionGate(db, reg);

    const url = await g.attempt("open_url", { url: "https://calendar.google.com" }, ctx);
    expect(url.kind).toBe("executed");
    if (url.kind === "executed") expect(url.result.ok).toBe(true);

    const app = await g.attempt("open_app", { name: "Notes" }, ctx);
    expect(app.kind).toBe("executed");

    expect(opened).toEqual(["url:https://calendar.google.com", "app:Notes"]);
  });

  it("does not register mac actions without a mac api", () => {
    const reg = new ActionRegistry();
    registerBuiltins(reg, { memory, db });
    expect(reg.get("open_url")).toBeUndefined();
    expect(reg.get("open_app")).toBeUndefined();
  });

  it("prospect actions: save (tier 0), list, and move status", async () => {
    const { ProspectRepo } = await import("../../prospects/repo.js");
    const reg = new ActionRegistry();
    registerBuiltins(reg, { memory, db, prospects: new ProspectRepo(db) });
    const g = new ActionGate(db, reg);

    const saved = await g.attempt(
      "save_prospect",
      { name: "Bob's Barbershop", businessType: "salon", town: "Emmaus" },
      ctx
    );
    expect(saved.kind).toBe("executed");

    const listed = await g.attempt("list_prospects", {}, ctx);
    expect(listed.kind).toBe("executed");
    if (listed.kind !== "executed") return;
    expect(listed.result.message).toMatch(/Bob's Barbershop.*no website/);

    const rows = listed.result.data as { id: string }[];
    const moved = await g.attempt(
      "set_prospect_status",
      { id: rows[0]!.id.slice(0, 8), status: "contacted" },
      ctx
    );
    expect(moved.kind).toBe("executed");
    if (moved.kind === "executed") expect(moved.result.message).toMatch(/contacted/);
  });
});
