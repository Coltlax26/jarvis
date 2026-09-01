export interface Db {
  /** Parameterized query for a single statement. */
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
  /** Run a raw SQL script that may contain multiple statements. No params. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function createDb(opts: {
  databaseUrl: string | null;
  pgliteDir?: string | ":memory:";
}): Promise<Db> {
  if (opts.databaseUrl) {
    const { makePostgresDb } = await import("./postgres.js");
    return makePostgresDb(opts.databaseUrl);
  }
  const { makePgliteDb } = await import("./pglite.js");
  return makePgliteDb(opts.pgliteDir ?? ":memory:");
}
