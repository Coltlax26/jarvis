import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../../test/helpers/db.js";
import type { Db } from "../../db/index.js";
import { MemoryRepo } from "../../memory/repo.js";
import { GoogleTokenRepo } from "./repo.js";

let db: Db;
let repo: GoogleTokenRepo;

beforeEach(async () => {
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
  repo = new GoogleTokenRepo(db);
});
afterEach(async () => {
  await db.close();
});

describe("GoogleTokenRepo", () => {
  it("stores and reads tokens", async () => {
    await repo.save("colt", {
      accessToken: "at-1",
      refreshToken: "rt-1",
      scope: "gmail calendar",
      tokenType: "Bearer",
      expiryDate: 123,
    });
    const t = await repo.get("colt");
    expect(t).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1", expiryDate: 123 });
  });

  it("keeps the stored refresh token when a refresh omits it", async () => {
    await repo.save("colt", { accessToken: "at-1", refreshToken: "rt-1" });
    await repo.save("colt", { accessToken: "at-2", expiryDate: 999 });
    const t = await repo.get("colt");
    expect(t?.refreshToken).toBe("rt-1");
    expect(t?.accessToken).toBe("at-2");
  });

  it("lists connected users and disconnects", async () => {
    await repo.save("colt", { refreshToken: "rt-1" });
    expect(await repo.connectedUserIds()).toEqual(["colt"]);
    await repo.delete("colt");
    expect(await repo.connectedUserIds()).toEqual([]);
    expect(await repo.get("colt")).toBeNull();
  });
});
