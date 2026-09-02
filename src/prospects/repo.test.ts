import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "../memory/repo.js";
import { ProspectRepo } from "./repo.js";

let db: Db;
let repo: ProspectRepo;

beforeEach(async () => {
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
  await new MemoryRepo(db).ensureUser("rich", "Rich");
  repo = new ProspectRepo(db);
});
afterEach(async () => {
  await db.close();
});

describe("ProspectRepo", () => {
  it("adds, lists, and dedupes on name+town", async () => {
    const a = await repo.add("colt", { name: "Joe's Pizza", town: "Macungie", businessType: "restaurant" });
    expect(a.status).toBe("new");
    const dup = await repo.add("colt", { name: "joe's pizza", town: "macungie", phone: "610-555-0000" });
    expect(dup.id).toBe(a.id); // same record, not a second row
    const list = await repo.list("colt");
    expect(list).toHaveLength(1);
  });

  it("updates status and notes, bumps updated_at", async () => {
    const p = await repo.add("colt", { name: "Acme Landscaping" });
    const before = p.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    const up = await repo.update("colt", p.id, { status: "interested", notes: "call back Monday" });
    expect(up?.status).toBe("interested");
    expect(up?.notes).toBe("call back Monday");
    expect(up!.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("scopes by user — Rich can't touch Colt's rows", async () => {
    const p = await repo.add("colt", { name: "Colt Co" });
    expect(await repo.get("rich", p.id)).toBeNull();
    expect(await repo.update("rich", p.id, { status: "won" })).toBeNull();
    expect(await repo.remove("rich", p.id)).toBe(false);
    expect(await repo.remove("colt", p.id)).toBe(true);
  });

  it("counts by status", async () => {
    await repo.add("colt", { name: "A" });
    await repo.add("colt", { name: "B" });
    const b = await repo.add("colt", { name: "C" });
    await repo.update("colt", b.id, { status: "won" });
    const counts = await repo.counts("colt");
    expect(counts.new).toBe(2);
    expect(counts.won).toBe(1);
  });
});
