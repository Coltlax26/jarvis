import { describe, it, expect, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "./index.js";

let db: Db;
afterEach(async () => {
  await db?.close();
});

describe("migrations", () => {
  it("applies 001_init and creates the core tables", async () => {
    db = await makeTestDb();
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "activity",
        "conversations",
        "messages",
        "memories",
        "pending_actions",
        "scheduled_messages",
        "schema_migrations",
        "session",
        "settings",
        "users",
      ])
    );
  });

  it("is idempotent — running twice applies nothing the second time", async () => {
    db = await makeTestDb();
    const { runMigrations } = await import("./migrate.js");
    const second = await runMigrations(db);
    expect(second.applied).toEqual([]);
  });
});
