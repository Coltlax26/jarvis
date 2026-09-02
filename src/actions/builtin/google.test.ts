import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../../test/helpers/db.js";
import type { Db } from "../../db/index.js";
import { MemoryRepo } from "../../memory/repo.js";
import { ActionRegistry } from "../registry.js";
import { ActionGate } from "../gate.js";
import { registerBuiltins } from "./index.js";
import type { GoogleActionsApi } from "./google.js";

let db: Db;
let gate: ActionGate;
let connected = true;
const created: unknown[] = [];

const fakeGoogle: GoogleActionsApi = {
  isConnected: async () => connected,
  recentInbox: async () => [
    { id: "m1", from: "Bob <bob@x.com>", subject: "Lunch?", snippet: "wanna grab lunch", date: "" },
  ],
  createDraft: async (_u, input) => {
    created.push(input);
    return { id: "draft-1" };
  },
  listEvents: async () => [
    { id: "e1", summary: "Standup", start: "2026-09-03T09:00:00Z", end: null, location: null, htmlLink: null },
  ],
  createEvent: async (_u, input) => ({
    id: "e2",
    summary: input.summary,
    start: input.start,
    end: input.end,
    location: input.location ?? null,
    htmlLink: null,
  }),
  updateEvent: async (_u, id, patch) => ({
    id,
    summary: "Standup",
    start: patch.start ?? null,
    end: patch.end ?? null,
    location: null,
    htmlLink: null,
  }),
  deleteEvent: async (_u, id) => {
    deleted.push(id);
  },
};
const deleted: string[] = [];

beforeEach(async () => {
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
  const reg = new ActionRegistry();
  registerBuiltins(reg, { memory: new MemoryRepo(db), db, google: fakeGoogle });
  gate = new ActionGate(db, reg);
  connected = true;
  created.length = 0;
  deleted.length = 0;
});
afterEach(async () => {
  await db.close();
});

const ctx = { userId: "colt", originSurface: "web" };

describe("google actions", () => {
  it("read_inbox is tier 0 and returns a summary", async () => {
    const out = await gate.attempt("read_inbox", {}, ctx);
    expect(out.kind).toBe("executed");
    if (out.kind === "executed") expect(out.result.message).toMatch(/Lunch\?/);
  });

  it("read_inbox reports cleanly when not connected", async () => {
    connected = false;
    const out = await gate.attempt("read_inbox", {}, ctx);
    expect(out.kind).toBe("executed");
    if (out.kind === "executed") {
      expect(out.result.ok).toBe(false);
      expect(out.result.message).toMatch(/Connect Google/i);
    }
  });

  it("draft_email is tier 1 and only drafts after approval", async () => {
    const held = await gate.attempt(
      "draft_email",
      { to: "bob@x.com", subject: "Re: Lunch?", body: "Yes — noon works." },
      ctx
    );
    expect(held.kind).toBe("held");
    if (held.kind !== "held") return;
    expect(held.tier).toBe(1);
    expect(created).toHaveLength(0);
    const res = await gate.approve(held.pendingId, "colt");
    expect(res.ok).toBe(true);
    expect(created[0]).toMatchObject({ to: "bob@x.com" });
  });

  it("add_event and move_event are tier 1", async () => {
    const add = await gate.attempt(
      "add_event",
      { summary: "Dentist", startIso: "2026-09-04T15:00:00Z", endIso: "2026-09-04T16:00:00Z" },
      ctx
    );
    expect(add.kind).toBe("held");
    const move = await gate.attempt(
      "move_event",
      { eventId: "e1", startIso: "2026-09-04T17:00:00Z", endIso: "2026-09-04T18:00:00Z" },
      ctx
    );
    expect(move.kind).toBe("held");
    if (move.kind === "held") expect(move.tier).toBe(1);
  });

  it("list_events is tier 0", async () => {
    const out = await gate.attempt("list_events", {}, ctx);
    expect(out.kind).toBe("executed");
    if (out.kind === "executed") expect(out.result.message).toMatch(/Standup/);
  });

  it("delete_event is tier 1 and only deletes after approval", async () => {
    const held = await gate.attempt("delete_event", { eventId: "e1" }, ctx);
    expect(held.kind).toBe("held");
    if (held.kind !== "held") return;
    expect(held.tier).toBe(1);
    expect(deleted).toHaveLength(0);
    const res = await gate.approve(held.pendingId, "colt");
    expect(res.ok).toBe(true);
    expect(deleted).toEqual(["e1"]);
  });

  it("does not register google actions when no api is given", () => {
    const reg = new ActionRegistry();
    registerBuiltins(reg, { memory: new MemoryRepo(db), db });
    expect(reg.get("read_inbox")).toBeUndefined();
  });
});
