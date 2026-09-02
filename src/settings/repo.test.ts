import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "../memory/repo.js";
import { SettingsRepo } from "./repo.js";

let db: Db;
let repo: SettingsRepo;

beforeEach(async () => {
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
  repo = new SettingsRepo(db);
});
afterEach(async () => {
  await db.close();
});

describe("SettingsRepo", () => {
  it("returns the fallback when unset, the stored value when set", async () => {
    expect(await repo.get("colt", "tz", "UTC")).toBe("UTC");
    await repo.set("colt", "tz", "America/New_York");
    expect(await repo.get("colt", "tz", "UTC")).toBe("America/New_York");
  });

  it("clearing a value falls back to the default again", async () => {
    await repo.set("colt", "greeting", "Hi there");
    await repo.set("colt", "greeting", "");
    expect(await repo.get("colt", "greeting", "Good day")).toBe("Good day");
    expect((await repo.all("colt")).greeting).toBeUndefined();
  });

  it("setMany writes a batch and all() reads it back", async () => {
    await repo.setMany("colt", { a: "1", b: "2" });
    expect(await repo.all("colt")).toEqual({ a: "1", b: "2" });
  });
});
