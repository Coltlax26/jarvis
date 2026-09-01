import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Db } from "./index.js";

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations"
);

export async function runMigrations(db: Db): Promise<{ applied: string[] }> {
  await db.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const { rows } = await db.query<{ name: string }>(
    `select name from schema_migrations`
  );
  const done = new Set(rows.map((r) => r.name));

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied: string[] = [];

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    await db.exec("begin");
    try {
      await db.exec(sql);
      await db.query(`insert into schema_migrations (name) values ($1)`, [file]);
      await db.exec("commit");
      applied.push(file);
    } catch (err) {
      await db.exec("rollback").catch(() => {});
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return { applied };
}
