import pg from "pg";
import type { Db } from "./index.js";

export function makePostgresDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    ssl:
      connectionString.includes("localhost") ||
      connectionString.includes("127.0.0.1")
        ? undefined
        : { rejectUnauthorized: false },
  });
  return {
    async query(text, params) {
      const res = await pool.query(text, params as unknown[]);
      return { rows: res.rows };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}
