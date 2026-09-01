import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "../memory/repo.js";
import { Scheduler } from "./index.js";

let db: Db;
const delivered: string[] = [];

beforeEach(async () => {
  delivered.length = 0;
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
});
afterEach(async () => {
  await db.close();
});

async function schedule(body: string, deliverAt: Date) {
  await db.query(
    `insert into scheduled_messages (id, user_id, deliver_at, body) values ($1,'colt',$2,$3)`,
    [randomUUID(), deliverAt.toISOString(), body]
  );
}

describe("Scheduler", () => {
  it("delivers only due messages and marks them sent", async () => {
    await schedule("past", new Date(Date.now() - 1000));
    await schedule("future", new Date(Date.now() + 3600_000));
    const s = new Scheduler({
      db,
      userId: "colt",
      deliver: async (m) => {
        delivered.push(m.text);
      },
    });
    const n = await s.tick();
    expect(n).toBe(1);
    expect(delivered).toEqual(["past"]);
    const { rows } = await db.query<{ status: string; body: string }>(
      `select status, body from scheduled_messages order by body`
    );
    expect(rows).toEqual([
      { status: "pending", body: "future" },
      { status: "sent", body: "past" },
    ]);
  });

  it("leaves a row pending if delivery throws", async () => {
    await schedule("boom", new Date(Date.now() - 1000));
    const s = new Scheduler({
      db,
      userId: "colt",
      deliver: async () => {
        throw new Error("no");
      },
    });
    const n = await s.tick();
    expect(n).toBe(0);
    const { rows } = await db.query<{ status: string }>(`select status from scheduled_messages`);
    expect(rows[0]!.status).toBe("pending");
  });
});
