import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./index.js";

export async function makePgliteDb(dir: string | ":memory:"): Promise<Db> {
  const pglite = dir === ":memory:" ? new PGlite() : new PGlite(dir);
  await pglite.waitReady;
  return {
    async query(text, params) {
      const res = await pglite.query(text, params as unknown[]);
      return { rows: res.rows as never[] };
    },
    async exec(sql) {
      await pglite.exec(sql);
    },
    async close() {
      await pglite.close();
    },
  };
}
