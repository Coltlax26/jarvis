import { createDb, type Db } from "../../src/db/index.js";
import { runMigrations } from "../../src/db/migrate.js";

export async function makeTestDb(): Promise<Db> {
  const db = await createDb({ databaseUrl: null, pgliteDir: ":memory:" });
  await runMigrations(db);
  return db;
}
