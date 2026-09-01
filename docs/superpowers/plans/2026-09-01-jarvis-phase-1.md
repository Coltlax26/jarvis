# Jarvis Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the always-on core of Jarvis — a personal AI assistant with shared memory, a 3-tier action gate, a reminder scheduler, and two ways in (Telegram and a web chat page) — and deploy it to Railway.

**Architecture:** One Node process. A surface-agnostic "brain" wraps the Claude Agent SDK. All state (history, long-term memory, pending approvals, reminders) lives in Postgres, reached through a thin `Db` wrapper that runs PGlite locally and real Postgres in production. Surface adapters (Telegram, web) translate between an outside channel and the brain. Every capability Jarvis has is a registered `Action` with a tier; a single `ActionGate` enforces the tier rules for all of them.

**Tech Stack:** TypeScript, Node 24, `@anthropic-ai/claude-agent-sdk`, `zod`, `pg` (prod DB), `@electric-sql/pglite` (local/test DB), `grammy` (Telegram), `express` + `cookie` + `express-session` (web), `vitest` (tests), `tsx` (dev runner), `esbuild` via `tsc` for build.

**Spec:** `docs/superpowers/specs/2026-09-01-jarvis-design.md`

## Global Constraints

- Node engine floor: `>=22`. Target Node 24.
- Language: TypeScript, `"module": "NodeNext"`, `"strict": true`. No `any` in committed code except where a third-party type forces it (comment why).
- Main model id: `claude-opus-5`. Background model id: `claude-haiku-4-5`. Never date-suffix these.
- Agent SDK package: `@anthropic-ai/claude-agent-sdk` (pinned to the version installed in Task 1; record it).
- Single user. The Telegram adapter must reject any chat id that is not `OWNER_TELEGRAM_ID`. The web adapter must require `WEB_PASSWORD`.
- Tier 2 actions can never be auto-approved, pre-approved, or batch-approved. One explicit human approval per execution, always.
- All secrets come from environment variables. `.env` is gitignored. Never commit a real key.
- Agent SDK file/shell tools operate only inside `WORKSPACE_DIR` (default `./workspace`), never the repo root or the server filesystem at large.
- Every task ends with a passing `npm test` and a commit.
- Commit message trailer on every commit:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FkRBGjPyRZYFNyEzU8hxMN
  ```

---

## File Structure

```
jarvis/
  package.json
  tsconfig.json
  vitest.config.ts
  .env.example
  .gitignore                       # already exists
  railway.json                     # Task 12
  Procfile                         # Task 12
  CLAUDE.md                        # Task 12
  migrations/
    001_init.sql                   # Task 3
  src/
    config.ts                      # Task 2 — typed env config
    logger.ts                      # Task 2 — tiny structured logger
    db/
      index.ts                     # Task 3 — Db interface + factory
      pglite.ts                    # Task 3 — PGlite-backed Db
      postgres.ts                  # Task 3 — pg.Pool-backed Db
      migrate.ts                   # Task 3 — migration runner
    memory/
      types.ts                     # Task 4
      repo.ts                      # Task 4 — conversations, messages, memories
    actions/
      types.ts                     # Task 5 — Action, Tier, PendingAction
      registry.ts                  # Task 5 — register/lookup actions
      gate.ts                      # Task 5 — ActionGate: tier enforcement + approvals
      builtin/
        remember.ts                # Task 6 — tier 0
        setReminder.ts             # Task 6 — tier 0
        sendTestMessage.ts         # Task 6 — tier 1 demo
        spendTest.ts               # Task 6 — tier 2 demo
    core/
      types.ts                     # Task 7 — IncomingMessage, OutgoingMessage, ModelRunner
      promptBuilder.ts             # Task 7 — builds system + user prompt from memory
      sdkRunner.ts                 # Task 7 — ModelRunner backed by the Agent SDK
      fakeRunner.ts                # Task 7 — ModelRunner for tests
      brain.ts                     # Task 7 — orchestrates a turn
    surfaces/
      types.ts                     # Task 8 — Surface interface
      registry.ts                  # Task 8 — SurfaceRegistry: route OutgoingMessage by surface
      telegram/index.ts            # Task 9
      web/index.ts                 # Task 10
      web/public/                  # Task 10 — chat page assets
    scheduler/
      index.ts                     # Task 11 — interval loop + due selection
    server.ts                      # Task 12 — wire everything, boot
  test/
    helpers/db.ts                  # Task 3 — makeTestDb()
    ...*.test.ts                   # colocated per task under test/
  workspace/                       # gitignored — Agent SDK sandbox + local PGlite file
  docs/superpowers/
    specs/2026-09-01-jarvis-design.md
    plans/2026-09-01-jarvis-phase-1.md
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/index-smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: working `npm run build`, `npm test`, `npm run dev` scripts. TypeScript strict config other tasks compile against.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "jarvis",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm i @anthropic-ai/claude-agent-sdk zod pg @electric-sql/pglite grammy express express-session
npm i -D typescript tsx vitest @types/node @types/express @types/express-session
```
Then record the installed `@anthropic-ai/claude-agent-sdk` version in `CLAUDE.md` later (Task 12). Expected: installs clean, `found 0 vulnerabilities` or only advisory notices.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
```

- [ ] **Step 5: Create `.env.example`**

```bash
# Anthropic
ANTHROPIC_API_KEY=

# Database — set by Railway in production. Leave blank locally to use PGlite.
DATABASE_URL=

# Web chat
WEB_PASSWORD=
SESSION_SECRET=change-me-to-a-long-random-string

# Telegram
TELEGRAM_BOT_TOKEN=
OWNER_TELEGRAM_ID=

# Behaviour
TZ=America/Denver
WORKSPACE_DIR=./workspace
PUBLIC_URL=http://localhost:3000
PORT=3000
NODE_ENV=development
```

- [ ] **Step 6: Write the smoke test**

`src/index-smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run tests, verify pass**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 8: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors (no `src/**` files yet besides the test).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold Jarvis TypeScript project"
```

---

### Task 2: Config and logger

**Files:**
- Create: `src/config.ts`, `src/logger.ts`, `src/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `loadConfig(env?: NodeJS.ProcessEnv): Config` — throws `ConfigError` listing every missing/invalid required var at once.
  - `type Config = { anthropicApiKey: string; databaseUrl: string | null; webPassword: string; sessionSecret: string; telegramBotToken: string | null; ownerTelegramId: string | null; tz: string; workspaceDir: string; publicUrl: string; port: number; nodeEnv: "development" | "production" | "test" }`
  - `logger` with `logger.info(msg, fields?)`, `.warn`, `.error(msg, err?, fields?)` — writes one JSON line to stdout.

- [ ] **Step 1: Write the failing test**

`src/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "./config.js";

const base = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  WEB_PASSWORD: "hunter2",
  SESSION_SECRET: "x".repeat(32),
};

describe("loadConfig", () => {
  it("parses a minimal valid env with PGlite fallback", () => {
    const c = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(c.anthropicApiKey).toBe("sk-ant-test");
    expect(c.databaseUrl).toBeNull();
    expect(c.port).toBe(3000);
    expect(c.tz).toBe("America/Denver");
  });

  it("collects all missing required vars into one error", () => {
    try {
      loadConfig({} as NodeJS.ProcessEnv);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain("ANTHROPIC_API_KEY");
      expect(msg).toContain("WEB_PASSWORD");
      expect(msg).toContain("SESSION_SECRET");
    }
  });

  it("passes DATABASE_URL through when set", () => {
    const c = loadConfig({ ...base, DATABASE_URL: "postgres://u:p@h/db" } as NodeJS.ProcessEnv);
    expect(c.databaseUrl).toBe("postgres://u:p@h/db");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `Cannot find module './config.js'`.

- [ ] **Step 3: Implement `src/logger.ts`**

```ts
type Fields = Record<string, unknown>;

function line(level: string, msg: string, fields?: Fields) {
  const rec = { t: new Date().toISOString(), level, msg, ...fields };
  process.stdout.write(JSON.stringify(rec) + "\n");
}

export const logger = {
  info: (msg: string, fields?: Fields) => line("info", msg, fields),
  warn: (msg: string, fields?: Fields) => line("warn", msg, fields),
  error: (msg: string, err?: unknown, fields?: Fields) =>
    line("error", msg, {
      ...fields,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    }),
};
```

- [ ] **Step 4: Implement `src/config.ts`**

```ts
export class ConfigError extends Error {}

export type Config = {
  anthropicApiKey: string;
  databaseUrl: string | null;
  webPassword: string;
  sessionSecret: string;
  telegramBotToken: string | null;
  ownerTelegramId: string | null;
  tz: string;
  workspaceDir: string;
  publicUrl: string;
  port: number;
  nodeEnv: "development" | "production" | "test";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const req = (k: string): string => {
    const v = env[k];
    if (!v || v.trim() === "") {
      missing.push(k);
      return "";
    }
    return v;
  };

  const anthropicApiKey = req("ANTHROPIC_API_KEY");
  const webPassword = req("WEB_PASSWORD");
  const sessionSecret = req("SESSION_SECRET");

  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const nodeEnvRaw = env.NODE_ENV ?? "development";
  const nodeEnv =
    nodeEnvRaw === "production" || nodeEnvRaw === "test" ? nodeEnvRaw : "development";

  return {
    anthropicApiKey,
    databaseUrl: env.DATABASE_URL?.trim() ? env.DATABASE_URL.trim() : null,
    webPassword,
    sessionSecret,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() || null,
    ownerTelegramId: env.OWNER_TELEGRAM_ID?.trim() || null,
    tz: env.TZ?.trim() || "America/Denver",
    workspaceDir: env.WORKSPACE_DIR?.trim() || "./workspace",
    publicUrl: env.PUBLIC_URL?.trim() || "http://localhost:3000",
    port: Number.parseInt(env.PORT ?? "3000", 10) || 3000,
    nodeEnv,
  };
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `npx vitest run src/config.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add typed config loader and JSON logger"
```

---

### Task 3: Database wrapper and migration runner

**Files:**
- Create: `src/db/index.ts`, `src/db/pglite.ts`, `src/db/postgres.ts`, `src/db/migrate.ts`, `migrations/001_init.sql`, `test/helpers/db.ts`, `src/db/migrate.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 2) — specifically `databaseUrl`, `workspaceDir`.
- Produces:
  - `interface Db { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>; close(): Promise<void>; }`
  - `createDb(opts: { databaseUrl: string | null; pgliteDir?: string | ":memory:" }): Promise<Db>` — returns Postgres-backed Db when `databaseUrl` set, else PGlite-backed.
  - `runMigrations(db: Db): Promise<{ applied: string[] }>` — reads `migrations/*.sql` sorted by filename, applies any not in `schema_migrations`, each file in a transaction.
  - `makeTestDb(): Promise<Db>` (test helper) — in-memory PGlite with migrations applied.

- [ ] **Step 1: Write the failing test**

`src/db/migrate.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "./index.js";

let db: Db;
afterEach(async () => { await db?.close(); });

describe("migrations", () => {
  it("applies 001_init and creates the core tables", async () => {
    db = await makeTestDb();
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "conversations", "messages", "memories",
        "pending_actions", "scheduled_messages", "schema_migrations", "users",
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
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/db/migrate.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/db/index.ts`**

```ts
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
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
```

- [ ] **Step 4: Implement `src/db/postgres.ts`**

```ts
import pg from "pg";
import type { Db } from "./index.js";

export function makePostgresDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  return {
    async query(text, params) {
      const res = await pool.query(text, params as unknown[]);
      return { rows: res.rows };
    },
    async close() {
      await pool.end();
    },
  };
}
```

- [ ] **Step 5: Implement `src/db/pglite.ts`**

```ts
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
    async close() {
      await pglite.close();
    },
  };
}
```

- [ ] **Step 6: Implement `src/db/migrate.ts`**

```ts
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Db } from "./index.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export async function runMigrations(db: Db): Promise<{ applied: string[] }> {
  await db.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const { rows } = await db.query<{ name: string }>(`select name from schema_migrations`);
  const done = new Set(rows.map((r) => r.name));

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    await db.query("begin");
    try {
      await db.query(sql);
      await db.query(`insert into schema_migrations (name) values ($1)`, [file]);
      await db.query("commit");
      applied.push(file);
    } catch (err) {
      await db.query("rollback");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return { applied };
}
```

- [ ] **Step 7: Create `migrations/001_init.sql`**

```sql
create table users (
  id           text primary key,
  name         text not null,
  notes        text not null default '',
  created_at   timestamptz not null default now()
);

create table conversations (
  id           text primary key,
  user_id      text not null references users(id),
  created_at   timestamptz not null default now()
);

create table messages (
  id               text primary key,
  conversation_id  text not null references conversations(id),
  role             text not null check (role in ('user','assistant','system')),
  surface          text not null,
  content          text not null,
  created_at       timestamptz not null default now()
);
create index messages_conv_created_idx on messages (conversation_id, created_at);

create table memories (
  id           text primary key,
  user_id      text not null references users(id),
  content      text not null,
  source       text not null default 'assistant',
  keywords     text[] not null default '{}',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create table pending_actions (
  id             text primary key,
  user_id        text not null references users(id),
  action_name    text not null,
  input          jsonb not null,
  tier           int not null check (tier in (1,2)),
  status         text not null check (status in
                   ('draft','awaiting_approval','approved','rejected','done','failed')),
  origin_surface text not null,
  summary        text not null default '',
  result         jsonb,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index pending_actions_open_idx on pending_actions (user_id, status);

create table scheduled_messages (
  id           text primary key,
  user_id      text not null references users(id),
  deliver_at   timestamptz not null,
  body         text not null,
  source       text not null default 'reminder',
  status       text not null check (status in ('pending','sent','canceled')) default 'pending',
  created_at   timestamptz not null default now()
);
create index scheduled_messages_due_idx on scheduled_messages (status, deliver_at);
```

- [ ] **Step 8: Implement `test/helpers/db.ts`**

```ts
import { createDb, type Db } from "../../src/db/index.js";
import { runMigrations } from "../../src/db/migrate.js";

export async function makeTestDb(): Promise<Db> {
  const db = await createDb({ databaseUrl: null, pgliteDir: ":memory:" });
  await runMigrations(db);
  return db;
}
```

- [ ] **Step 9: Run test, verify pass**

Run: `npx vitest run src/db/migrate.test.ts`
Expected: 2 passed. If PGlite rejects `text[]` array default or `jsonb`, it will not — PGlite is real Postgres; both are supported. If `information_schema` query shape differs, adjust the column alias only.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add Db wrapper (PGlite/Postgres) and migration runner with Phase 1 schema"
```

---

### Task 4: Memory repository

**Files:**
- Create: `src/memory/types.ts`, `src/memory/repo.ts`, `src/memory/repo.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 3).
- Produces `MemoryRepo` (a class constructed with `new MemoryRepo(db)`):
  - `ensureUser(id: string, name: string): Promise<void>`
  - `getOrCreateConversation(userId: string): Promise<string>` — returns the single active conversation id for the user, creating one if none.
  - `addMessage(m: { conversationId: string; role: "user" | "assistant" | "system"; surface: string; content: string }): Promise<Message>`
  - `recentMessages(conversationId: string, limit: number): Promise<Message[]>` — oldest-first.
  - `addMemory(m: { userId: string; content: string; source?: string; keywords?: string[] }): Promise<Memory>`
  - `searchMemories(userId: string, queryText: string, limit: number): Promise<Memory[]>` — matches when any keyword appears in `queryText` (case-insensitive) OR `content` shares a word with `queryText`; falls back to most-recent when nothing matches. Touches `last_used_at` on returned rows.
  - Types in `types.ts`: `Message`, `Memory` (fields mirror the columns; timestamps as `Date`).

- [ ] **Step 1: Write the failing test**

`src/memory/repo.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "./repo.js";

let db: Db;
let repo: MemoryRepo;

beforeEach(async () => {
  db = await makeTestDb();
  repo = new MemoryRepo(db);
  await repo.ensureUser("colt", "Colt");
});
afterEach(async () => { await db.close(); });

describe("MemoryRepo", () => {
  it("creates one conversation and reuses it", async () => {
    const a = await repo.getOrCreateConversation("colt");
    const b = await repo.getOrCreateConversation("colt");
    expect(a).toBe(b);
  });

  it("stores and returns messages oldest-first", async () => {
    const conv = await repo.getOrCreateConversation("colt");
    await repo.addMessage({ conversationId: conv, role: "user", surface: "web", content: "hi" });
    await repo.addMessage({ conversationId: conv, role: "assistant", surface: "web", content: "hello" });
    const msgs = await repo.recentMessages(conv, 10);
    expect(msgs.map((m) => m.content)).toEqual(["hi", "hello"]);
  });

  it("finds memories by keyword and falls back to recent", async () => {
    await repo.addMemory({ userId: "colt", content: "Colt's dog is named Rex", keywords: ["dog", "rex"] });
    await repo.addMemory({ userId: "colt", content: "Colt prefers plain writing", keywords: ["writing", "style"] });
    const hit = await repo.searchMemories("colt", "what is my dog called", 5);
    expect(hit.some((m) => m.content.includes("Rex"))).toBe(true);

    const fallback = await repo.searchMemories("colt", "completely unrelated xyzzy", 1);
    expect(fallback).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/memory/repo.test.ts`
Expected: FAIL — `./repo.js` not found.

- [ ] **Step 3: Implement `src/memory/types.ts`**

```ts
export type Role = "user" | "assistant" | "system";

export type Message = {
  id: string;
  conversationId: string;
  role: Role;
  surface: string;
  content: string;
  createdAt: Date;
};

export type Memory = {
  id: string;
  userId: string;
  content: string;
  source: string;
  keywords: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
};
```

- [ ] **Step 4: Implement `src/memory/repo.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import type { Memory, Message, Role } from "./types.js";

const words = (s: string): string[] =>
  s.toLowerCase().match(/[a-z0-9']+/g)?.filter((w) => w.length > 2) ?? [];

export class MemoryRepo {
  constructor(private db: Db) {}

  async ensureUser(id: string, name: string): Promise<void> {
    await this.db.query(
      `insert into users (id, name) values ($1, $2) on conflict (id) do nothing`,
      [id, name]
    );
  }

  async getOrCreateConversation(userId: string): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from conversations where user_id = $1 order by created_at asc limit 1`,
      [userId]
    );
    if (rows[0]) return rows[0].id;
    const id = randomUUID();
    await this.db.query(`insert into conversations (id, user_id) values ($1, $2)`, [id, userId]);
    return id;
  }

  async addMessage(m: {
    conversationId: string;
    role: Role;
    surface: string;
    content: string;
  }): Promise<Message> {
    const id = randomUUID();
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into messages (id, conversation_id, role, surface, content)
       values ($1,$2,$3,$4,$5) returning *`,
      [id, m.conversationId, m.role, m.surface, m.content]
    );
    return rowToMessage(rows[0]!);
  }

  async recentMessages(conversationId: string, limit: number): Promise<Message[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from (
         select * from messages where conversation_id = $1 order by created_at desc limit $2
       ) t order by created_at asc`,
      [conversationId, limit]
    );
    return rows.map(rowToMessage);
  }

  async addMemory(m: {
    userId: string;
    content: string;
    source?: string;
    keywords?: string[];
  }): Promise<Memory> {
    const id = randomUUID();
    const kw = m.keywords && m.keywords.length ? m.keywords : words(m.content).slice(0, 8);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into memories (id, user_id, content, source, keywords)
       values ($1,$2,$3,$4,$5) returning *`,
      [id, m.userId, m.content, m.source ?? "assistant", kw]
    );
    return rowToMemory(rows[0]!);
  }

  async searchMemories(userId: string, queryText: string, limit: number): Promise<Memory[]> {
    const qWords = new Set(words(queryText));
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from memories where user_id = $1 order by created_at desc limit 200`,
      [userId]
    );
    const all = rows.map(rowToMemory);
    const scored = all
      .map((mem) => {
        const hay = new Set([...mem.keywords.map((k) => k.toLowerCase()), ...words(mem.content)]);
        let score = 0;
        for (const w of qWords) if (hay.has(w)) score++;
        return { mem, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.mem);

    const chosen = scored.length ? scored : all.slice(0, limit);
    if (chosen.length) {
      await this.db.query(
        `update memories set last_used_at = now() where id = any($1)`,
        [chosen.map((m) => m.id)]
      );
    }
    return chosen;
  }
}

function rowToMessage(r: Record<string, unknown>): Message {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    role: r.role as Role,
    surface: r.surface as string,
    content: r.content as string,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToMemory(r: Record<string, unknown>): Memory {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    content: r.content as string,
    source: r.source as string,
    keywords: (r.keywords as string[]) ?? [],
    createdAt: new Date(r.created_at as string),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string) : null,
  };
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `npx vitest run src/memory/repo.test.ts`
Expected: 3 passed. Note: `$2` as `limit` in PGlite/pg works; if PGlite complains about a parameter in `LIMIT`, inline the validated integer instead.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add memory repository: conversations, messages, keyword memory search"
```

---

### Task 5: Action gate

**Files:**
- Create: `src/actions/types.ts`, `src/actions/registry.ts`, `src/actions/gate.ts`, `src/actions/gate.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 3).
- Produces:
  - `type Tier = 0 | 1 | 2`
  - `interface Action<I = Record<string, unknown>> { name: string; tier: Tier; description: string; schema: import("zod").ZodType<I>; summarize(input: I): string; run(input: I, ctx: ActionContext): Promise<ActionResult>; }`
  - `type ActionContext = { userId: string; originSurface: string }`
  - `type ActionResult = { ok: boolean; message: string; data?: unknown }`
  - `class ActionRegistry { register(a: Action): void; get(name: string): Action | undefined; list(): Action[]; }`
  - `class ActionGate` constructed `new ActionGate(db, registry)`:
    - `attempt(name: string, rawInput: unknown, ctx: ActionContext): Promise<GateOutcome>` where
      `type GateOutcome = { kind: "executed"; result: ActionResult } | { kind: "held"; pendingId: string; tier: Tier; summary: string } | { kind: "rejected"; reason: string }`
      - tier 0 → runs immediately → `executed`
      - tier 1 → row status `draft` → `held`
      - tier 2 → row status `awaiting_approval` → `held`
      - unknown action or schema failure → `rejected`
    - `listPending(userId: string): Promise<PendingAction[]>`
    - `approve(pendingId: string, userId: string): Promise<ActionResult>` — loads row, re-validates, runs `action.run`, sets status `done`/`failed`, stores result. Throws if not found / not owned / not in an approvable state.
    - `reject(pendingId: string, userId: string): Promise<void>` — sets status `rejected`.
  - `type PendingAction` mirrors the table (camelCase, `input` parsed).

- [ ] **Step 1: Write the failing test**

`src/actions/gate.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "../memory/repo.js";
import { ActionRegistry } from "./registry.js";
import { ActionGate } from "./gate.js";
import type { Action } from "./types.js";

let db: Db;
let gate: ActionGate;
const ran: string[] = [];

function makeAction(name: string, tier: 0 | 1 | 2): Action<{ text: string }> {
  return {
    name,
    tier,
    description: `test ${name}`,
    schema: z.object({ text: z.string() }),
    summarize: (i) => `${name}: ${i.text}`,
    run: async (i) => {
      ran.push(`${name}:${i.text}`);
      return { ok: true, message: `did ${name}` };
    },
  };
}

beforeEach(async () => {
  ran.length = 0;
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
  const reg = new ActionRegistry();
  reg.register(makeAction("note", 0));
  reg.register(makeAction("dm", 1));
  reg.register(makeAction("buy", 2));
  gate = new ActionGate(db, reg);
});
afterEach(async () => { await db.close(); });

const ctx = { userId: "colt", originSurface: "web" };

describe("ActionGate", () => {
  it("runs tier 0 immediately", async () => {
    const out = await gate.attempt("note", { text: "hi" }, ctx);
    expect(out.kind).toBe("executed");
    expect(ran).toEqual(["note:hi"]);
  });

  it("holds tier 1 as draft without running", async () => {
    const out = await gate.attempt("dm", { text: "hey bob" }, ctx);
    expect(out.kind).toBe("held");
    expect(ran).toEqual([]);
    const pending = await gate.listPending("colt");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe("draft");
  });

  it("holds tier 2 as awaiting_approval", async () => {
    const out = await gate.attempt("buy", { text: "tickets" }, ctx);
    expect(out.kind).toBe("held");
    const pending = await gate.listPending("colt");
    expect(pending[0]!.status).toBe("awaiting_approval");
  });

  it("runs the action on approve and marks it done", async () => {
    const out = await gate.attempt("buy", { text: "tickets" }, ctx);
    if (out.kind !== "held") throw new Error("expected held");
    const res = await gate.approve(out.pendingId, "colt");
    expect(res.ok).toBe(true);
    expect(ran).toEqual(["buy:tickets"]);
    const pending = await gate.listPending("colt");
    expect(pending).toHaveLength(0);
  });

  it("does not run the action on reject", async () => {
    const out = await gate.attempt("dm", { text: "x" }, ctx);
    if (out.kind !== "held") throw new Error("expected held");
    await gate.reject(out.pendingId, "colt");
    expect(ran).toEqual([]);
    await expect(gate.approve(out.pendingId, "colt")).rejects.toThrow();
  });

  it("rejects unknown actions and bad input", async () => {
    expect((await gate.attempt("nope", {}, ctx)).kind).toBe("rejected");
    expect((await gate.attempt("note", { text: 5 }, ctx)).kind).toBe("rejected");
  });

  it("refuses cross-user approval", async () => {
    const out = await gate.attempt("buy", { text: "y" }, ctx);
    if (out.kind !== "held") throw new Error("expected held");
    await expect(gate.approve(out.pendingId, "someone-else")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/actions/gate.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/actions/types.ts`**

```ts
import type { ZodType } from "zod";

export type Tier = 0 | 1 | 2;

export type ActionContext = { userId: string; originSurface: string };
export type ActionResult = { ok: boolean; message: string; data?: unknown };

export interface Action<I = Record<string, unknown>> {
  name: string;
  tier: Tier;
  description: string;
  schema: ZodType<I>;
  summarize(input: I): string;
  run(input: I, ctx: ActionContext): Promise<ActionResult>;
}

export type PendingStatus =
  | "draft" | "awaiting_approval" | "approved" | "rejected" | "done" | "failed";

export type PendingAction = {
  id: string;
  userId: string;
  actionName: string;
  input: Record<string, unknown>;
  tier: Exclude<Tier, 0>;
  status: PendingStatus;
  originSurface: string;
  summary: string;
  result: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
};
```

- [ ] **Step 4: Implement `src/actions/registry.ts`**

```ts
import type { Action } from "./types.js";

export class ActionRegistry {
  private map = new Map<string, Action>();

  register(a: Action): void {
    if (this.map.has(a.name)) throw new Error(`Action already registered: ${a.name}`);
    this.map.set(a.name, a);
  }
  get(name: string): Action | undefined {
    return this.map.get(name);
  }
  list(): Action[] {
    return [...this.map.values()];
  }
}
```

- [ ] **Step 5: Implement `src/actions/gate.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import type { ActionRegistry } from "./registry.js";
import type { ActionContext, ActionResult, PendingAction, Tier } from "./types.js";

export type GateOutcome =
  | { kind: "executed"; result: ActionResult }
  | { kind: "held"; pendingId: string; tier: Exclude<Tier, 0>; summary: string }
  | { kind: "rejected"; reason: string };

export class ActionGate {
  constructor(private db: Db, private registry: ActionRegistry) {}

  async attempt(name: string, rawInput: unknown, ctx: ActionContext): Promise<GateOutcome> {
    const action = this.registry.get(name);
    if (!action) return { kind: "rejected", reason: `Unknown action: ${name}` };

    const parsed = action.schema.safeParse(rawInput);
    if (!parsed.success) {
      return { kind: "rejected", reason: `Invalid input for ${name}: ${parsed.error.message}` };
    }
    const input = parsed.data;

    if (action.tier === 0) {
      const result = await action.run(input, ctx);
      return { kind: "executed", result };
    }

    const id = randomUUID();
    const status = action.tier === 1 ? "draft" : "awaiting_approval";
    const summary = safeSummary(action, input);
    await this.db.query(
      `insert into pending_actions
        (id, user_id, action_name, input, tier, status, origin_surface, summary)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, ctx.userId, name, JSON.stringify(input), action.tier, status, ctx.originSurface, summary]
    );
    return { kind: "held", pendingId: id, tier: action.tier, summary };
  }

  async listPending(userId: string): Promise<PendingAction[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from pending_actions
       where user_id = $1 and status in ('draft','awaiting_approval')
       order by created_at asc`,
      [userId]
    );
    return rows.map(rowToPending);
  }

  async approve(pendingId: string, userId: string): Promise<ActionResult> {
    const row = await this.load(pendingId);
    if (!row) throw new Error(`No pending action ${pendingId}`);
    if (row.userId !== userId) throw new Error(`Pending action ${pendingId} is not yours`);
    if (row.status !== "draft" && row.status !== "awaiting_approval") {
      throw new Error(`Pending action ${pendingId} is ${row.status}, cannot approve`);
    }
    const action = this.registry.get(row.actionName);
    if (!action) throw new Error(`Action ${row.actionName} no longer exists`);

    const parsed = action.schema.safeParse(row.input);
    if (!parsed.success) {
      await this.finish(pendingId, "failed", { error: parsed.error.message });
      throw new Error(`Stored input for ${row.actionName} is no longer valid`);
    }

    try {
      const result = await action.run(parsed.data, {
        userId: row.userId,
        originSurface: row.originSurface,
      });
      await this.finish(pendingId, result.ok ? "done" : "failed", result);
      return result;
    } catch (err) {
      const result: ActionResult = { ok: false, message: (err as Error).message };
      await this.finish(pendingId, "failed", result);
      return result;
    }
  }

  async reject(pendingId: string, userId: string): Promise<void> {
    const row = await this.load(pendingId);
    if (!row) throw new Error(`No pending action ${pendingId}`);
    if (row.userId !== userId) throw new Error(`Pending action ${pendingId} is not yours`);
    await this.finish(pendingId, "rejected", null);
  }

  private async load(id: string): Promise<PendingAction | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from pending_actions where id = $1`,
      [id]
    );
    return rows[0] ? rowToPending(rows[0]) : null;
  }

  private async finish(id: string, status: string, result: unknown): Promise<void> {
    await this.db.query(
      `update pending_actions set status = $2, result = $3, resolved_at = now() where id = $1`,
      [id, status, result === null ? null : JSON.stringify(result)]
    );
  }
}

function safeSummary(action: { summarize: (i: never) => string }, input: unknown): string {
  try {
    return action.summarize(input as never);
  } catch {
    return "";
  }
}

function rowToPending(r: Record<string, unknown>): PendingAction {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    actionName: r.action_name as string,
    input: typeof r.input === "string" ? JSON.parse(r.input) : (r.input as Record<string, unknown>),
    tier: Number(r.tier) as 1 | 2,
    status: r.status as PendingAction["status"],
    originSurface: r.origin_surface as string,
    summary: (r.summary as string) ?? "",
    result:
      typeof r.result === "string" ? JSON.parse(r.result) : (r.result ?? null),
    createdAt: new Date(r.created_at as string),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at as string) : null,
  };
}
```

- [ ] **Step 6: Run test, verify pass**

Run: `npx vitest run src/actions/gate.test.ts`
Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add action gate: tier enforcement, pending-action persistence, approve/reject"
```

---

### Task 6: Built-in actions

**Files:**
- Create: `src/actions/builtin/remember.ts`, `src/actions/builtin/setReminder.ts`, `src/actions/builtin/sendTestMessage.ts`, `src/actions/builtin/spendTest.ts`, `src/actions/builtin/index.ts`, `src/actions/builtin/builtin.test.ts`

**Interfaces:**
- Consumes: `MemoryRepo` (Task 4), `Db` (Task 3), `Action` (Task 5).
- Produces `registerBuiltins(reg: ActionRegistry, deps: { memory: MemoryRepo; db: Db }): void` which registers:
  - `remember` (tier 0) — input `{ content: string; keywords?: string[] }` → writes a memory.
  - `set_reminder` (tier 0) — input `{ deliverAt: string /* ISO */; body: string }` → inserts a `scheduled_messages` row.
  - `send_test_message` (tier 1) — input `{ to: string; text: string }` → on run, returns `{ ok: true, message: "pretended to send ..." }` (placeholder until Phase 2 real messaging).
  - `spend_test` (tier 2) — input `{ amountUsd: number; note: string }` → on run returns ok with an echo (placeholder for real spend).

- [ ] **Step 1: Write the failing test**

`src/actions/builtin/builtin.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../../test/helpers/db.js";
import type { Db } from "../../db/index.js";
import { MemoryRepo } from "../../memory/repo.js";
import { ActionRegistry } from "../registry.js";
import { ActionGate } from "../gate.js";
import { registerBuiltins } from "./index.js";

let db: Db;
let gate: ActionGate;
let memory: MemoryRepo;

beforeEach(async () => {
  db = await makeTestDb();
  memory = new MemoryRepo(db);
  await memory.ensureUser("colt", "Colt");
  const reg = new ActionRegistry();
  registerBuiltins(reg, { memory, db });
  gate = new ActionGate(db, reg);
});
afterEach(async () => { await db.close(); });

const ctx = { userId: "colt", originSurface: "web" };

describe("builtin actions", () => {
  it("remember stores a retrievable memory", async () => {
    const out = await gate.attempt("remember", { content: "Colt's car is a blue Civic" }, ctx);
    expect(out.kind).toBe("executed");
    const hits = await memory.searchMemories("colt", "what car do I drive", 5);
    expect(hits.some((m) => m.content.includes("Civic"))).toBe(true);
  });

  it("set_reminder inserts a pending scheduled message", async () => {
    const when = new Date(Date.now() + 3600_000).toISOString();
    await gate.attempt("set_reminder", { deliverAt: when, body: "call mom" }, ctx);
    const { rows } = await db.query<{ body: string; status: string }>(
      `select body, status from scheduled_messages`
    );
    expect(rows[0]).toMatchObject({ body: "call mom", status: "pending" });
  });

  it("send_test_message is tier 1 (held, not run)", async () => {
    const out = await gate.attempt("send_test_message", { to: "bob", text: "hi" }, ctx);
    expect(out.kind).toBe("held");
    if (out.kind === "held") expect(out.tier).toBe(1);
  });

  it("spend_test is tier 2", async () => {
    const out = await gate.attempt("spend_test", { amountUsd: 10, note: "dinner" }, ctx);
    expect(out.kind).toBe("held");
    if (out.kind === "held") expect(out.tier).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/actions/builtin/builtin.test.ts`
Expected: FAIL — `./index.js` not found.

- [ ] **Step 3: Implement the four action files**

`src/actions/builtin/remember.ts`:
```ts
import { z } from "zod";
import type { MemoryRepo } from "../../memory/repo.js";
import type { Action } from "../types.js";

export function rememberAction(memory: MemoryRepo): Action<{ content: string; keywords?: string[] }> {
  return {
    name: "remember",
    tier: 0,
    description: "Save a durable fact about Colt, his preferences, people, or projects.",
    schema: z.object({ content: z.string().min(3), keywords: z.array(z.string()).optional() }),
    summarize: (i) => `remember: ${i.content}`,
    run: async (i, ctx) => {
      await memory.addMemory({ userId: ctx.userId, content: i.content, keywords: i.keywords });
      return { ok: true, message: "Saved." };
    },
  };
}
```

`src/actions/builtin/setReminder.ts`:
```ts
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../../db/index.js";
import type { Action } from "../types.js";

export function setReminderAction(db: Db): Action<{ deliverAt: string; body: string }> {
  return {
    name: "set_reminder",
    tier: 0,
    description:
      "Schedule a proactive message to Colt at a specific time. deliverAt must be an ISO 8601 timestamp.",
    schema: z.object({
      deliverAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO timestamp"),
      body: z.string().min(1),
    }),
    summarize: (i) => `reminder @ ${i.deliverAt}: ${i.body}`,
    run: async (i, ctx) => {
      await db.query(
        `insert into scheduled_messages (id, user_id, deliver_at, body, source)
         values ($1,$2,$3,$4,'reminder')`,
        [randomUUID(), ctx.userId, new Date(i.deliverAt).toISOString(), i.body]
      );
      return { ok: true, message: `Reminder set for ${i.deliverAt}.` };
    },
  };
}
```

`src/actions/builtin/sendTestMessage.ts`:
```ts
import { z } from "zod";
import type { Action } from "../types.js";

export function sendTestMessageAction(): Action<{ to: string; text: string }> {
  return {
    name: "send_test_message",
    tier: 1,
    description:
      "Draft a message to another person. Held for Colt's approval. Real delivery arrives in Phase 2.",
    schema: z.object({ to: z.string().min(1), text: z.string().min(1) }),
    summarize: (i) => `message to ${i.to}: ${i.text}`,
    run: async (i) => ({ ok: true, message: `(placeholder) would send to ${i.to}: "${i.text}"` }),
  };
}
```

`src/actions/builtin/spendTest.ts`:
```ts
import { z } from "zod";
import type { Action } from "../types.js";

export function spendTestAction(): Action<{ amountUsd: number; note: string }> {
  return {
    name: "spend_test",
    tier: 2,
    description:
      "Spend money on Colt's behalf. Requires explicit approval every time. Real payments arrive later.",
    schema: z.object({ amountUsd: z.number().positive(), note: z.string().min(1) }),
    summarize: (i) => `spend $${i.amountUsd} — ${i.note}`,
    run: async (i) => ({ ok: true, message: `(placeholder) approved spend of $${i.amountUsd} for ${i.note}` }),
  };
}
```

`src/actions/builtin/index.ts`:
```ts
import type { Db } from "../../db/index.js";
import type { MemoryRepo } from "../../memory/repo.js";
import type { ActionRegistry } from "../registry.js";
import { rememberAction } from "./remember.js";
import { setReminderAction } from "./setReminder.js";
import { sendTestMessageAction } from "./sendTestMessage.js";
import { spendTestAction } from "./spendTest.js";

export function registerBuiltins(
  reg: ActionRegistry,
  deps: { memory: MemoryRepo; db: Db }
): void {
  reg.register(rememberAction(deps.memory) as never);
  reg.register(setReminderAction(deps.db) as never);
  reg.register(sendTestMessageAction() as never);
  reg.register(spendTestAction() as never);
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/actions/builtin/builtin.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add built-in actions: remember, set_reminder, and tier 1/2 demo actions"
```

---

### Task 7: The brain

**Files:**
- Create: `src/core/types.ts`, `src/core/promptBuilder.ts`, `src/core/fakeRunner.ts`, `src/core/sdkRunner.ts`, `src/core/brain.ts`, `src/core/brain.test.ts`

**Interfaces:**
- Consumes: `MemoryRepo` (Task 4), `ActionGate` + `ActionRegistry` (Task 5), `Config` (Task 2).
- Produces:
  - `type IncomingMessage = { userId: string; surface: string; text: string }`
  - `type OutgoingMessage = { userId: string; surface: string; text: string }`
  - `interface ModelRunner { run(req: RunRequest): Promise<RunResult>; }`
    - `type RunRequest = { systemPrompt: string; userPrompt: string; toolActions: Action[]; onToolAttempt: (name: string, input: unknown) => Promise<ToolDecision>; }`
    - `type ToolDecision = { allow: true } | { allow: false; message: string }`
    - `type RunResult = { text: string; costUsd: number }`
  - `class FakeRunner implements ModelRunner` — constructed with a script: `new FakeRunner(steps)` where `steps` is an array of `{ callTool?: { name: string; input: unknown }; say: string }`. It invokes `onToolAttempt` for each `callTool` and concatenates `say` strings into `text`.
  - `class SdkRunner implements ModelRunner` — wraps `@anthropic-ai/claude-agent-sdk`'s `query()`. Maps `toolActions` to in-process tools via `tool()` + `createSdkMcpServer()`; routes every tool call through `onToolAttempt` inside `canUseTool`; allows the built-in read-only tools; sets `cwd` to the workspace dir; reads the final `result` message.
  - `class Brain` constructed `new Brain({ memory, gate, registry, runner, config })`:
    - `handle(msg: IncomingMessage): Promise<OutgoingMessage>` — loads history + memories, builds prompts, runs the model, persists both messages, returns the reply. Tool attempts during the run go through `gate.attempt(...)`; a `held` outcome becomes a `ToolDecision` deny whose message tells the model it is awaiting Colt's approval (including the pending id).

- [ ] **Step 1: Write the failing test**

`src/core/brain.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "../memory/repo.js";
import { ActionRegistry } from "../actions/registry.js";
import { ActionGate } from "../actions/gate.js";
import { registerBuiltins } from "../actions/builtin/index.js";
import { Brain } from "./brain.js";
import { FakeRunner } from "./fakeRunner.js";

let db: Db;
let memory: MemoryRepo;
let gate: ActionGate;
let registry: ActionRegistry;

beforeEach(async () => {
  db = await makeTestDb();
  memory = new MemoryRepo(db);
  await memory.ensureUser("colt", "Colt");
  registry = new ActionRegistry();
  registerBuiltins(registry, { memory, db });
  gate = new ActionGate(db, registry);
});
afterEach(async () => { await db.close(); });

const cfg = { tz: "America/Denver", workspaceDir: "./workspace" } as never;

describe("Brain", () => {
  it("answers and persists both sides of the turn", async () => {
    const runner = new FakeRunner([{ say: "Hello Colt." }]);
    const brain = new Brain({ memory, gate, registry, runner, config: cfg });
    const out = await brain.handle({ userId: "colt", surface: "web", text: "hi" });
    expect(out.text).toBe("Hello Colt.");
    const conv = await memory.getOrCreateConversation("colt");
    const msgs = await memory.recentMessages(conv, 10);
    expect(msgs.map((m) => `${m.role}:${m.content}`)).toEqual(["user:hi", "assistant:Hello Colt."]);
  });

  it("shares history across surfaces", async () => {
    const b1 = new Brain({ memory, gate, registry, runner: new FakeRunner([{ say: "noted" }]), config: cfg });
    await b1.handle({ userId: "colt", surface: "telegram", text: "my cat is Milo" });
    const capturing = new FakeRunner([{ say: "" }]);
    const b2 = new Brain({ memory, gate, registry, runner: capturing, config: cfg });
    await b2.handle({ userId: "colt", surface: "web", text: "what's my cat's name?" });
    expect(capturing.lastUserPrompt).toContain("my cat is Milo");
  });

  it("runs a tier 0 tool call through the gate", async () => {
    const runner = new FakeRunner([
      { callTool: { name: "remember", input: { content: "Colt's cat is Milo" } }, say: "Got it." },
    ]);
    const brain = new Brain({ memory, gate, registry, runner, config: cfg });
    await brain.handle({ userId: "colt", surface: "web", text: "remember my cat is Milo" });
    const hits = await memory.searchMemories("colt", "cat name", 5);
    expect(hits.some((m) => m.content.includes("Milo"))).toBe(true);
  });

  it("denies a tier 2 tool call and tells the model it is pending", async () => {
    const seen: string[] = [];
    const runner = new FakeRunner([
      { callTool: { name: "spend_test", input: { amountUsd: 5, note: "x" } }, say: "I asked for approval." },
    ]);
    runner.onDeny = (m) => seen.push(m);
    const brain = new Brain({ memory, gate, registry, runner, config: cfg });
    await brain.handle({ userId: "colt", surface: "web", text: "buy x" });
    expect(seen[0]).toMatch(/approval/i);
    const pending = await gate.listPending("colt");
    expect(pending).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/core/brain.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/core/types.ts`**

```ts
import type { Action } from "../actions/types.js";

export type IncomingMessage = { userId: string; surface: string; text: string };
export type OutgoingMessage = { userId: string; surface: string; text: string };

export type ToolDecision = { allow: true } | { allow: false; message: string };

export type RunRequest = {
  systemPrompt: string;
  userPrompt: string;
  toolActions: Action[];
  onToolAttempt: (name: string, input: unknown) => Promise<ToolDecision>;
};

export type RunResult = { text: string; costUsd: number };

export interface ModelRunner {
  run(req: RunRequest): Promise<RunResult>;
}
```

- [ ] **Step 4: Implement `src/core/promptBuilder.ts`**

```ts
import type { Action } from "../actions/types.js";
import type { Memory, Message } from "../memory/types.js";

export function buildSystemPrompt(opts: {
  tz: string;
  now: Date;
  actions: Action[];
  memories: Memory[];
}): string {
  const tierName = { 0: "automatic", 1: "draft, needs Colt's approval to send", 2: "needs Colt's explicit approval every time" } as const;
  const actionLines = opts.actions
    .map((a) => `- ${a.name} (tier ${a.tier}: ${tierName[a.tier]}) — ${a.description}`)
    .join("\n");
  const memoryLines = opts.memories.length
    ? opts.memories.map((m) => `- ${m.content}`).join("\n")
    : "- (nothing saved yet)";

  return [
    "You are Jarvis, Colt's personal assistant.",
    "Be direct and useful. Keep prose plain and simple: short sentences, minimal punctuation, not clever-sounding.",
    `Current time: ${opts.now.toISOString()} (Colt's timezone: ${opts.tz}).`,
    "",
    "What you know about Colt:",
    memoryLines,
    "",
    "Actions you can take (the system enforces the tier — you do not need to ask permission yourself for tier 0):",
    actionLines,
    "",
    "When you save something worth remembering long-term, use the remember action.",
    "For anything that messages another person, spends money, or is hard to undo, call the action anyway — the system will hold it for Colt and tell you it is pending. Then let Colt know you have queued it.",
  ].join("\n");
}

export function buildUserPrompt(history: Message[], incomingText: string): string {
  const lines = history.map((m) => `${m.role === "assistant" ? "Jarvis" : m.role === "system" ? "System" : "Colt"}: ${m.content}`);
  lines.push(`Colt: ${incomingText}`);
  return lines.join("\n");
}
```

- [ ] **Step 5: Implement `src/core/fakeRunner.ts`**

```ts
import type { ModelRunner, RunRequest, RunResult } from "./types.js";

export type FakeStep = { callTool?: { name: string; input: unknown }; say: string };

export class FakeRunner implements ModelRunner {
  lastUserPrompt = "";
  lastSystemPrompt = "";
  onDeny?: (message: string) => void;

  constructor(private steps: FakeStep[]) {}

  async run(req: RunRequest): Promise<RunResult> {
    this.lastUserPrompt = req.userPrompt;
    this.lastSystemPrompt = req.systemPrompt;
    const parts: string[] = [];
    for (const step of this.steps) {
      if (step.callTool) {
        const decision = await req.onToolAttempt(step.callTool.name, step.callTool.input);
        if (!decision.allow) this.onDeny?.(decision.message);
      }
      if (step.say) parts.push(step.say);
    }
    return { text: parts.join(" ").trim(), costUsd: 0 };
  }
}
```

- [ ] **Step 6: Implement `src/core/sdkRunner.ts`**

```ts
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ModelRunner, RunRequest, RunResult } from "./types.js";
import { logger } from "../logger.js";

const SAFE_BUILTIN_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];

export class SdkRunner implements ModelRunner {
  constructor(private opts: { model: string; apiKey: string; workspaceDir: string }) {}

  async run(req: RunRequest): Promise<RunResult> {
    process.env.ANTHROPIC_API_KEY = this.opts.apiKey;

    const jarvisTools = req.toolActions.map((action) =>
      tool(
        action.name,
        action.description,
        // zod raw shape: reuse the action's object schema shape when available
        (action.schema as unknown as { shape?: z.ZodRawShape }).shape ?? { input: z.any() },
        async (args: Record<string, unknown>) => {
          const decision = await req.onToolAttempt(action.name, args);
          if (!decision.allow) {
            return { content: [{ type: "text" as const, text: decision.message }], isError: true };
          }
          return { content: [{ type: "text" as const, text: `ok: ${action.name} accepted` }] };
        }
      )
    );

    const server = createSdkMcpServer({ name: "jarvis", version: "1.0.0", tools: jarvisTools });

    let finalText = "";
    let cost = 0;

    for await (const message of query({
      prompt: `${req.userPrompt}`,
      options: {
        model: this.opts.model,
        systemPrompt: req.systemPrompt,
        cwd: this.opts.workspaceDir,
        mcpServers: { jarvis: server },
        allowedTools: [
          ...SAFE_BUILTIN_TOOLS,
          ...req.toolActions.map((a) => `mcp__jarvis__${a.name}`),
        ],
        permissionMode: "default",
      },
    })) {
      if (message.type === "result") {
        if (message.subtype === "success") finalText = message.result;
        cost = message.total_cost_usd ?? 0;
      }
    }
    if (!finalText) logger.warn("SdkRunner produced no final text");
    return { text: finalText, costUsd: cost };
  }
}
```

> Implementation note for the executor: confirm the tool-call → `onToolAttempt` path against the installed SDK. The `tool()` handler above is the choke point. If the SDK's `canUseTool` option is preferred for MCP tools, move the `onToolAttempt` call into a `canUseTool` callback that matches `toolName === \`mcp__jarvis__${name}\`` and returns `{ behavior: "allow" }` / `{ behavior: "deny", message }`. Keep the `ModelRunner` interface unchanged so `Brain` and its tests do not move.

- [ ] **Step 7: Implement `src/core/brain.ts`**

```ts
import type { Config } from "../config.js";
import type { ActionGate } from "../actions/gate.js";
import type { ActionRegistry } from "../actions/registry.js";
import type { MemoryRepo } from "../memory/repo.js";
import { buildSystemPrompt, buildUserPrompt } from "./promptBuilder.js";
import type { IncomingMessage, ModelRunner, OutgoingMessage, ToolDecision } from "./types.js";

export class Brain {
  private memory: MemoryRepo;
  private gate: ActionGate;
  private registry: ActionRegistry;
  private runner: ModelRunner;
  private config: Pick<Config, "tz" | "workspaceDir">;

  constructor(deps: {
    memory: MemoryRepo;
    gate: ActionGate;
    registry: ActionRegistry;
    runner: ModelRunner;
    config: Pick<Config, "tz" | "workspaceDir">;
  }) {
    this.memory = deps.memory;
    this.gate = deps.gate;
    this.registry = deps.registry;
    this.runner = deps.runner;
    this.config = deps.config;
  }

  async handle(msg: IncomingMessage): Promise<OutgoingMessage> {
    const conversationId = await this.memory.getOrCreateConversation(msg.userId);
    const history = await this.memory.recentMessages(conversationId, 30);
    const memories = await this.memory.searchMemories(msg.userId, msg.text, 12);

    const actions = this.registry.list();
    const systemPrompt = buildSystemPrompt({
      tz: this.config.tz,
      now: new Date(),
      actions,
      memories,
    });
    const userPrompt = buildUserPrompt(history, msg.text);

    await this.memory.addMessage({
      conversationId,
      role: "user",
      surface: msg.surface,
      content: msg.text,
    });

    const result = await this.runner.run({
      systemPrompt,
      userPrompt,
      toolActions: actions,
      onToolAttempt: async (name, input): Promise<ToolDecision> => {
        const outcome = await this.gate.attempt(name, input, {
          userId: msg.userId,
          originSurface: msg.surface,
        });
        if (outcome.kind === "executed") {
          return outcome.result.ok
            ? { allow: true }
            : { allow: false, message: `Action failed: ${outcome.result.message}` };
        }
        if (outcome.kind === "held") {
          const kind = outcome.tier === 1 ? "drafted and is waiting" : "is waiting";
          return {
            allow: false,
            message: `This ${kind} for Colt's approval (pending id ${outcome.pendingId}). Tell Colt it is queued; do not assume it happened.`,
          };
        }
        return { allow: false, message: `Rejected: ${outcome.reason}` };
      },
    });

    const replyText = result.text || "(no reply)";
    await this.memory.addMessage({
      conversationId,
      role: "assistant",
      surface: msg.surface,
      content: replyText,
    });

    return { userId: msg.userId, surface: msg.surface, text: replyText };
  }
}
```

- [ ] **Step 8: Run test, verify pass**

Run: `npx vitest run src/core/brain.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `sdkRunner.ts` has SDK type friction, narrow with a localized `// @ts-expect-error` plus a comment, or adjust to the installed SDK's real signatures — do not weaken `tsconfig`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add the brain: prompt builder, SDK runner, fake runner, turn orchestration"
```

---

### Task 8: Surface interface and registry

**Files:**
- Create: `src/surfaces/types.ts`, `src/surfaces/registry.ts`, `src/surfaces/registry.test.ts`

**Interfaces:**
- Consumes: `OutgoingMessage` (Task 7).
- Produces:
  - `interface Surface { name: string; start(): Promise<void>; stop(): Promise<void>; send(userId: string, text: string): Promise<void>; }`
  - `class SurfaceRegistry { add(s: Surface): void; get(name: string): Surface | undefined; startAll(): Promise<void>; stopAll(): Promise<void>; deliver(msg: OutgoingMessage): Promise<void>; }`
    - `deliver` looks up the surface by `msg.surface` and calls `send`; if the surface is unknown it tries every registered surface in turn (used by the scheduler, which has no origin surface) and logs which delivered.

- [ ] **Step 1: Write the failing test**

`src/surfaces/registry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SurfaceRegistry } from "./registry.js";
import type { Surface } from "./types.js";

function fakeSurface(name: string, sink: string[]): Surface {
  return {
    name,
    start: async () => {},
    stop: async () => {},
    send: async (userId, text) => { sink.push(`${name}->${userId}:${text}`); },
  };
}

describe("SurfaceRegistry", () => {
  it("delivers to the named surface", async () => {
    const sink: string[] = [];
    const reg = new SurfaceRegistry();
    reg.add(fakeSurface("web", sink));
    reg.add(fakeSurface("telegram", sink));
    await reg.deliver({ userId: "colt", surface: "telegram", text: "hi" });
    expect(sink).toEqual(["telegram->colt:hi"]);
  });

  it("broadcasts when the surface is unknown", async () => {
    const sink: string[] = [];
    const reg = new SurfaceRegistry();
    reg.add(fakeSurface("web", sink));
    reg.add(fakeSurface("telegram", sink));
    await reg.deliver({ userId: "colt", surface: "scheduler", text: "reminder" });
    expect(sink.sort()).toEqual(["telegram->colt:reminder", "web->colt:reminder"]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/surfaces/registry.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/surfaces/types.ts`**

```ts
export interface Surface {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(userId: string, text: string): Promise<void>;
}
```

- [ ] **Step 4: Implement `src/surfaces/registry.ts`**

```ts
import { logger } from "../logger.js";
import type { OutgoingMessage } from "../core/types.js";
import type { Surface } from "./types.js";

export class SurfaceRegistry {
  private surfaces = new Map<string, Surface>();

  add(s: Surface): void {
    this.surfaces.set(s.name, s);
  }
  get(name: string): Surface | undefined {
    return this.surfaces.get(name);
  }
  async startAll(): Promise<void> {
    for (const s of this.surfaces.values()) await s.start();
  }
  async stopAll(): Promise<void> {
    for (const s of this.surfaces.values()) {
      try { await s.stop(); } catch (err) { logger.error(`surface ${s.name} stop failed`, err); }
    }
  }
  async deliver(msg: OutgoingMessage): Promise<void> {
    const target = this.surfaces.get(msg.surface);
    if (target) {
      await target.send(msg.userId, msg.text);
      return;
    }
    for (const s of this.surfaces.values()) {
      try {
        await s.send(msg.userId, msg.text);
        logger.info("broadcast delivery", { surface: s.name });
      } catch (err) {
        logger.error(`broadcast to ${s.name} failed`, err);
      }
    }
  }
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `npx vitest run src/surfaces/registry.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add Surface interface and SurfaceRegistry with broadcast delivery"
```

---

### Task 9: Telegram surface

**Files:**
- Create: `src/surfaces/telegram/index.ts`, `src/surfaces/telegram/parse.ts`, `src/surfaces/telegram/parse.test.ts`

**Interfaces:**
- Consumes: `Brain` (Task 7), `ActionGate` (Task 5), `Surface` (Task 8), `Config` (Task 2).
- Produces:
  - `parseCommand(text: string): { kind: "approve" | "reject"; id: string } | { kind: "list" } | { kind: "chat"; text: string }` — recognizes `approve <id>`, `reject <id>`, `list pending` / `pending`; everything else is `chat`.
  - `class TelegramSurface implements Surface` constructed `new TelegramSurface({ token, ownerId, brain, gate, userId })`:
    - On text message: reject if `String(chat.id) !== ownerId`. Otherwise `parseCommand`; route approve/reject/list to the gate, chat to `brain.handle({ userId, surface: "telegram", text })`, reply with the result.
    - `send(userId, text)` posts a message to `ownerId`.
    - `start()` calls `bot.start()` (long polling — no public URL needed); `stop()` calls `bot.stop()`.

- [ ] **Step 1: Write the failing test** (parser only — the bot needs network)

`src/surfaces/telegram/parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseCommand } from "./parse.js";

describe("parseCommand", () => {
  it("parses approve/reject with an id", () => {
    expect(parseCommand("approve 3f2a")).toEqual({ kind: "approve", id: "3f2a" });
    expect(parseCommand("  reject   9  ")).toEqual({ kind: "reject", id: "9" });
  });
  it("parses list pending", () => {
    expect(parseCommand("list pending")).toEqual({ kind: "list" });
    expect(parseCommand("pending")).toEqual({ kind: "list" });
  });
  it("treats everything else as chat", () => {
    expect(parseCommand("what's on my calendar?")).toEqual({
      kind: "chat", text: "what's on my calendar?",
    });
    expect(parseCommand("approve")).toEqual({ kind: "chat", text: "approve" });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/surfaces/telegram/parse.test.ts`
Expected: FAIL — `./parse.js` not found.

- [ ] **Step 3: Implement `src/surfaces/telegram/parse.ts`**

```ts
export type ParsedCommand =
  | { kind: "approve"; id: string }
  | { kind: "reject"; id: string }
  | { kind: "list" }
  | { kind: "chat"; text: string };

export function parseCommand(raw: string): ParsedCommand {
  const text = raw.trim();
  const m = /^(approve|reject)\s+(\S+)$/i.exec(text);
  if (m) return { kind: m[1]!.toLowerCase() as "approve" | "reject", id: m[2]! };
  if (/^(list\s+pending|pending)$/i.test(text)) return { kind: "list" };
  return { kind: "chat", text };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/surfaces/telegram/parse.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Implement `src/surfaces/telegram/index.ts`**

```ts
import { Bot } from "grammy";
import { logger } from "../../logger.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { Surface } from "../types.js";
import { parseCommand } from "./parse.js";

export class TelegramSurface implements Surface {
  readonly name = "telegram";
  private bot: Bot;

  constructor(
    private deps: { token: string; ownerId: string; userId: string; brain: Brain; gate: ActionGate }
  ) {
    this.bot = new Bot(deps.token);
    this.bot.on("message:text", async (ctx) => {
      if (String(ctx.chat.id) !== this.deps.ownerId) {
        await ctx.reply("This assistant is private.");
        return;
      }
      const cmd = parseCommand(ctx.message.text);
      try {
        if (cmd.kind === "list") {
          const pending = await this.deps.gate.listPending(this.deps.userId);
          await ctx.reply(
            pending.length
              ? pending.map((p) => `${p.id} — [tier ${p.tier}] ${p.summary}`).join("\n")
              : "Nothing pending."
          );
          return;
        }
        if (cmd.kind === "approve" || cmd.kind === "reject") {
          if (cmd.kind === "approve") {
            const r = await this.deps.gate.approve(cmd.id, this.deps.userId);
            await ctx.reply(r.message);
          } else {
            await this.deps.gate.reject(cmd.id, this.deps.userId);
            await ctx.reply("Rejected.");
          }
          return;
        }
        const out = await this.deps.brain.handle({
          userId: this.deps.userId, surface: "telegram", text: cmd.text,
        });
        await ctx.reply(out.text);
      } catch (err) {
        logger.error("telegram handler failed", err);
        await ctx.reply(`Something went wrong: ${(err as Error).message}`);
      }
    });
  }

  async start(): Promise<void> {
    // start() resolves when polling stops; run it detached.
    void this.bot.start({ onStart: () => logger.info("telegram polling started") });
  }
  async stop(): Promise<void> {
    await this.bot.stop();
  }
  async send(_userId: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(this.deps.ownerId, text);
  }
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add Telegram surface with owner gate and approve/reject/list commands"
```

---

### Task 10: Web chat surface

**Files:**
- Create: `src/surfaces/web/index.ts`, `src/surfaces/web/public/index.html`, `src/surfaces/web/public/app.js`, `src/surfaces/web/web.test.ts`

**Interfaces:**
- Consumes: `Brain` (Task 7), `ActionGate` (Task 5), `Surface` (Task 8), `Config` (Task 2).
- Produces:
  - `class WebSurface implements Surface` constructed `new WebSurface({ port, password, sessionSecret, userId, brain, gate, publicUrl })`:
    - `GET /` → login page if no session, else chat page.
    - `POST /login` → body `{ password }`; on match sets `req.session.authed = true`.
    - `POST /api/message` (authed) → body `{ text }` → `brain.handle(...)` → `{ reply }`.
    - `GET /api/pending` (authed) → `{ pending: [...] }`.
    - `POST /api/pending/:id/approve` and `/reject` (authed).
    - `GET /health` → `{ ok: true }` (no auth — for Railway).
    - `send(userId, text)` pushes to an in-memory ring buffer that `GET /api/inbox` (authed, long-poll or simple poll) returns and clears. (Phase 1: simple 3s client poll. SSE can come later.)
  - `createApp(deps)` returns the configured `express` app (exported for tests without binding a port).

- [ ] **Step 1: Write the failing test**

`src/surfaces/web/web.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "node:http";
import { makeTestDb } from "../../../test/helpers/db.js";
import type { Db } from "../../db/index.js";
import { MemoryRepo } from "../../memory/repo.js";
import { ActionRegistry } from "../../actions/registry.js";
import { ActionGate } from "../../actions/gate.js";
import { registerBuiltins } from "../../actions/builtin/index.js";
import { Brain } from "../../core/brain.js";
import { FakeRunner } from "../../core/fakeRunner.js";
import { createApp } from "./index.js";

let db: Db;
let app: import("express").Express;

beforeEach(async () => {
  db = await makeTestDb();
  const memory = new MemoryRepo(db);
  await memory.ensureUser("colt", "Colt");
  const registry = new ActionRegistry();
  registerBuiltins(registry, { memory, db });
  const gate = new ActionGate(db, registry);
  const brain = new Brain({
    memory, gate, registry,
    runner: new FakeRunner([{ say: "hi from jarvis" }]),
    config: { tz: "America/Denver", workspaceDir: "./workspace" } as never,
  });
  app = createApp({
    password: "hunter2", sessionSecret: "x".repeat(32),
    userId: "colt", brain, gate, publicUrl: "http://localhost",
  });
});
afterEach(async () => { await db.close(); });

// Minimal supertest-free helper
function call(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  return new Promise<{ status: number; body: any; cookie?: string }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const data = opts.body ? JSON.stringify(opts.body) : undefined;
      const req = request.request(
        { host: "127.0.0.1", port, path, method,
          headers: {
            "content-type": "application/json",
            ...(data ? { "content-length": Buffer.byteLength(data) } : {}),
            ...(opts.cookie ? { cookie: opts.cookie } : {}),
          } },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            server.close();
            const setCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
            let parsed: unknown = raw;
            try { parsed = JSON.parse(raw); } catch { /* html */ }
            resolve({ status: res.statusCode ?? 0, body: parsed, cookie: setCookie });
          });
        }
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  });
}

describe("WebSurface", () => {
  it("blocks /api/message without a session", async () => {
    const res = await call("POST", "/api/message", { body: { text: "hi" } });
    expect(res.status).toBe(401);
  });

  it("logs in and gets a reply", async () => {
    const login = await call("POST", "/login", { body: { password: "hunter2" } });
    expect(login.status).toBe(200);
    const res = await call("POST", "/api/message", { cookie: login.cookie, body: { text: "hi" } });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("hi from jarvis");
  });

  it("rejects a wrong password", async () => {
    const res = await call("POST", "/login", { body: { password: "nope" } });
    expect(res.status).toBe(401);
  });

  it("serves /health unauthenticated", async () => {
    const res = await call("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/surfaces/web/web.test.ts`
Expected: FAIL — `./index.js` not found.

- [ ] **Step 3: Implement `src/surfaces/web/index.ts`**

```ts
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import { logger } from "../../logger.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { Surface } from "../types.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");

type Deps = {
  password: string;
  sessionSecret: string;
  userId: string;
  brain: Brain;
  gate: ActionGate;
  publicUrl: string;
};

export function createApp(deps: Deps): Express {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: deps.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax", secure: deps.publicUrl.startsWith("https") },
    })
  );

  const inbox: string[] = [];

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if ((req.session as { authed?: boolean }).authed) return next();
    res.status(401).json({ error: "not authenticated" });
  };

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/login", (req, res) => {
    if (req.body?.password === deps.password) {
      (req.session as { authed?: boolean }).authed = true;
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: "wrong password" });
    }
  });

  app.post("/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.post("/api/message", requireAuth, async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "empty" });
    try {
      const out = await deps.brain.handle({ userId: deps.userId, surface: "web", text });
      res.json({ reply: out.text });
    } catch (err) {
      logger.error("web message failed", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/pending", requireAuth, async (_req, res) => {
    res.json({ pending: await deps.gate.listPending(deps.userId) });
  });
  app.post("/api/pending/:id/approve", requireAuth, async (req, res) => {
    try {
      const r = await deps.gate.approve(req.params.id!, deps.userId);
      res.json(r);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  app.post("/api/pending/:id/reject", requireAuth, async (req, res) => {
    try {
      await deps.gate.reject(req.params.id!, deps.userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/api/inbox", requireAuth, (_req, res) => {
    const items = inbox.splice(0, inbox.length);
    res.json({ items });
  });

  app.use(express.static(publicDir));
  app.get("/", (_req, res) => res.sendFile(join(publicDir, "index.html")));

  // expose the inbox to the Surface wrapper
  (app as unknown as { _inbox: string[] })._inbox = inbox;
  return app;
}

export class WebSurface implements Surface {
  readonly name = "web";
  private app: Express;
  private server: Server | null = null;

  constructor(private opts: Deps & { port: number }) {
    this.app = createApp(opts);
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server = createServer(this.app).listen(this.opts.port, () => {
        logger.info("web surface listening", { port: this.opts.port });
        resolve();
      });
    });
  }
  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
  async send(_userId: string, text: string): Promise<void> {
    (this.app as unknown as { _inbox: string[] })._inbox.push(text);
  }
}
```

- [ ] **Step 4: Implement `src/surfaces/web/public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; margin: 0; background: #0d0d0f; color: #e8e8ea; }
    #wrap { max-width: 720px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
    #log { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 8px 0; }
    .msg { padding: 10px 12px; border-radius: 10px; max-width: 85%; white-space: pre-wrap; }
    .me { align-self: flex-end; background: #2a5bd7; }
    .jarvis { align-self: flex-start; background: #1e1e24; }
    form { display: flex; gap: 8px; }
    input, button { font: inherit; padding: 10px; border-radius: 8px; border: 1px solid #333; background: #16161a; color: inherit; }
    input { flex: 1; }
    #login { align-self: center; margin: auto; display: flex; flex-direction: column; gap: 8px; }
  </style>
</head>
<body>
  <div id="wrap">
    <div id="log"></div>
    <form id="login"><input type="password" id="pw" placeholder="Password" /><button>Enter</button></form>
    <form id="chat" hidden><input id="text" placeholder="Message Jarvis" autocomplete="off" /><button>Send</button></form>
  </div>
  <script src="/app.js"></script>
</body>
</html>
```

`src/surfaces/web/public/app.js`:
```js
const log = document.getElementById("log");
const loginForm = document.getElementById("login");
const chatForm = document.getElementById("chat");

function add(text, who) {
  const el = document.createElement("div");
  el.className = "msg " + (who === "me" ? "me" : "jarvis");
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = document.getElementById("pw").value;
  const { status } = await post("/login", { password: pw });
  if (status === 200) { loginForm.hidden = true; chatForm.hidden = false; startPolling(); }
  else add("Wrong password.", "jarvis");
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("text");
  const text = input.value.trim();
  if (!text) return;
  add(text, "me");
  input.value = "";
  const { status, data } = await post("/api/message", { text });
  add(status === 200 ? data.reply : "Error: " + (data.error || status), "jarvis");
});

function startPolling() {
  setInterval(async () => {
    const r = await fetch("/api/inbox");
    if (!r.ok) return;
    const { items } = await r.json();
    for (const it of items) add(it, "jarvis");
  }, 3000);
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `npx vitest run src/surfaces/web/web.test.ts`
Expected: 4 passed. If `express` v5 default-exports differently under NodeNext, import as `import express from "express"` still works; adjust only if the compiler complains.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add web chat surface: password login, message API, pending approvals, health check"
```

---

### Task 11: Scheduler

**Files:**
- Create: `src/scheduler/index.ts`, `src/scheduler/index.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 3), `SurfaceRegistry` (Task 8).
- Produces:
  - `class Scheduler` constructed `new Scheduler({ db, deliver, userId, intervalMs? })` where `deliver: (msg: { userId: string; surface: string; text: string }) => Promise<void>`.
    - `tick(now?: Date): Promise<number>` — selects `scheduled_messages` rows with `status = 'pending'` and `deliver_at <= now`, delivers each (surface `"scheduler"`), marks them `sent`; returns the count delivered. A delivery that throws leaves the row `pending` for the next tick.
    - `start(): void` — `setInterval(tick, intervalMs ?? 60000)`, unref'd.
    - `stop(): void` — clears the interval.

- [ ] **Step 1: Write the failing test**

`src/scheduler/index.test.ts`:
```ts
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
afterEach(async () => { await db.close(); });

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
    const s = new Scheduler({ db, userId: "colt", deliver: async (m) => { delivered.push(m.text); } });
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
    const s = new Scheduler({ db, userId: "colt", deliver: async () => { throw new Error("no"); } });
    const n = await s.tick();
    expect(n).toBe(0);
    const { rows } = await db.query<{ status: string }>(`select status from scheduled_messages`);
    expect(rows[0]!.status).toBe("pending");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/scheduler/index.test.ts`
Expected: FAIL — `./index.js` not found.

- [ ] **Step 3: Implement `src/scheduler/index.ts`**

```ts
import { logger } from "../logger.js";
import type { Db } from "../db/index.js";

type DeliverFn = (msg: { userId: string; surface: string; text: string }) => Promise<void>;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private db: Db;
  private deliver: DeliverFn;
  private userId: string;
  private intervalMs: number;

  constructor(opts: { db: Db; deliver: DeliverFn; userId: string; intervalMs?: number }) {
    this.db = opts.db;
    this.deliver = opts.deliver;
    this.userId = opts.userId;
    this.intervalMs = opts.intervalMs ?? 60_000;
  }

  async tick(now: Date = new Date()): Promise<number> {
    const { rows } = await this.db.query<{ id: string; body: string; user_id: string }>(
      `select id, body, user_id from scheduled_messages
       where status = 'pending' and deliver_at <= $1
       order by deliver_at asc limit 20`,
      [now.toISOString()]
    );
    let sent = 0;
    for (const row of rows) {
      try {
        await this.deliver({ userId: row.user_id, surface: "scheduler", text: row.body });
        await this.db.query(`update scheduled_messages set status = 'sent' where id = $1`, [row.id]);
        sent++;
      } catch (err) {
        logger.error("scheduled delivery failed; will retry", err, { id: row.id });
      }
    }
    return sent;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => logger.error("scheduler tick failed", err));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/scheduler/index.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add reminder scheduler with retry-on-failure delivery"
```

---

### Task 12: Server entrypoint, CLAUDE.md, deploy config

**Files:**
- Create: `src/server.ts`, `CLAUDE.md`, `railway.json`, `Procfile`
- Modify: `.env.example` (only if a var was added since Task 1)

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run build && npm start` boots a process that runs migrations, wires the brain/gate/scheduler/surfaces, starts enabled surfaces, and stays up. Telegram starts only if `telegramBotToken` and `ownerTelegramId` are set. Web always starts.

- [ ] **Step 1: Implement `src/server.ts`**

```ts
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { MemoryRepo } from "./memory/repo.js";
import { ActionRegistry } from "./actions/registry.js";
import { ActionGate } from "./actions/gate.js";
import { registerBuiltins } from "./actions/builtin/index.js";
import { Brain } from "./core/brain.js";
import { SdkRunner } from "./core/sdkRunner.js";
import { SurfaceRegistry } from "./surfaces/registry.js";
import { WebSurface } from "./surfaces/web/index.js";
import { TelegramSurface } from "./surfaces/telegram/index.js";
import { Scheduler } from "./scheduler/index.js";
import { mkdir } from "node:fs/promises";

const USER_ID = "colt";
const USER_NAME = "Colt";

async function main() {
  const config = loadConfig();
  await mkdir(config.workspaceDir, { recursive: true });

  const db = await createDb({
    databaseUrl: config.databaseUrl,
    pgliteDir: config.databaseUrl ? undefined : `${config.workspaceDir}/dev.pglite`,
  });
  const { applied } = await runMigrations(db);
  logger.info("migrations complete", { applied });

  const memory = new MemoryRepo(db);
  await memory.ensureUser(USER_ID, USER_NAME);

  const registry = new ActionRegistry();
  registerBuiltins(registry, { memory, db });
  const gate = new ActionGate(db, registry);

  const runner = new SdkRunner({
    model: "claude-opus-5",
    apiKey: config.anthropicApiKey,
    workspaceDir: config.workspaceDir,
  });
  const brain = new Brain({ memory, gate, registry, runner, config });

  const surfaces = new SurfaceRegistry();
  surfaces.add(
    new WebSurface({
      port: config.port,
      password: config.webPassword,
      sessionSecret: config.sessionSecret,
      userId: USER_ID,
      brain,
      gate,
      publicUrl: config.publicUrl,
    })
  );
  if (config.telegramBotToken && config.ownerTelegramId) {
    surfaces.add(
      new TelegramSurface({
        token: config.telegramBotToken,
        ownerId: config.ownerTelegramId,
        userId: USER_ID,
        brain,
        gate,
      })
    );
  } else {
    logger.warn("Telegram disabled — set TELEGRAM_BOT_TOKEN and OWNER_TELEGRAM_ID to enable");
  }

  await surfaces.startAll();

  const scheduler = new Scheduler({
    db,
    userId: USER_ID,
    deliver: (msg) => surfaces.deliver(msg),
  });
  scheduler.start();

  logger.info("Jarvis is up");

  const shutdown = async () => {
    logger.info("shutting down");
    scheduler.stop();
    await surfaces.stopAll();
    await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error("fatal boot error", err);
  process.exit(1);
});
```

- [ ] **Step 2: Create `Procfile`**

```
web: npm start
```

- [ ] **Step 3: Create `railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS", "buildCommand": "npm run build" },
  "deploy": { "startCommand": "npm start", "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10 }
}
```

- [ ] **Step 4: Write `CLAUDE.md`**

Include: what Jarvis is (one paragraph, link the spec), the module map (copy the File Structure tree), how to run locally (`cp .env.example .env`, fill `ANTHROPIC_API_KEY` / `WEB_PASSWORD` / `SESSION_SECRET`, `npm i`, `npm run dev`), how tests work (PGlite, no external DB), the installed Agent SDK version, the action-tier rules verbatim from the spec, "how to add an action" (implement `Action`, register in `registerBuiltins`, tier decides everything), "how to add a surface" (implement `Surface`, add in `server.ts`), and the deploy target (Railway, `railway.json`). Keep prose plain and short.

- [ ] **Step 5: Build and boot locally**

Run:
```bash
npm run build
ANTHROPIC_API_KEY=sk-ant-xxx WEB_PASSWORD=test SESSION_SECRET=$(node -e "console.log('x'.repeat(40))") PORT=3000 npm start
```
Expected: logs `migrations complete`, `web surface listening`, `Jarvis is up`. Visit `http://localhost:3000`, log in with `test`, send "say hello" — expect a real reply from Opus 5. Ctrl-C exits cleanly.

- [ ] **Step 6: Full test run + typecheck**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add server entrypoint, CLAUDE.md, and Railway deploy config"
```

---

### Task 13: Deploy to Railway and write Colt's setup checklist

**Files:**
- Create: `docs/SETUP.md` (Colt-facing, one step at a time)

**Interfaces:**
- Consumes: a working build (Task 12).
- Produces: Jarvis live on a Railway URL, reachable from Telegram and the web page; `docs/SETUP.md` listing every account/key step in order.

- [ ] **Step 1: Push the repo to GitHub**

Run (Colt must create the empty repo first — this is step 1 of `SETUP.md`):
```bash
git remote add origin https://github.com/<colt>/jarvis.git
git push -u origin main
```

- [ ] **Step 2: Create the Railway project**

In Railway: New Project → Deploy from GitHub repo → pick `jarvis`. Add a Postgres database to the project (New → Database → Postgres). Railway sets `DATABASE_URL` automatically.

- [ ] **Step 3: Set Railway environment variables**

`ANTHROPIC_API_KEY`, `WEB_PASSWORD`, `SESSION_SECRET` (40+ random chars), `TZ` (Colt's timezone), `PUBLIC_URL` (the Railway-provided domain, `https://...`), and after Step 5, `TELEGRAM_BOT_TOKEN` + `OWNER_TELEGRAM_ID`. `PORT` is provided by Railway — do not set it.

- [ ] **Step 4: Generate a domain and verify**

Railway → Settings → Networking → Generate Domain. Open `https://<domain>/health` — expect `{"ok":true}`. Open `https://<domain>/` and log in.

- [ ] **Step 5: Create the Telegram bot**

Message @BotFather → `/newbot` → follow prompts → copy the token into `TELEGRAM_BOT_TOKEN`. Message @userinfobot (or @RawDataBot) to get your numeric user id → set `OWNER_TELEGRAM_ID`. Redeploy. Send your bot a message — expect a reply.

- [ ] **Step 6: End-to-end check**

- Web: send "remember that my sister's name is Dana". Then on Telegram: "what's my sister's name?" — expect "Dana" (shared memory).
- Telegram: "set a reminder for 2 minutes from now to stretch" — expect a proactive message ~2 min later on both surfaces.
- Web: "buy me concert tickets" — expect Jarvis to say it queued a Tier 2 action. Send "list pending" on Telegram, then "approve <id>" — expect the placeholder confirmation.

- [ ] **Step 7: Write `docs/SETUP.md`**

One numbered list, plain language, one action per step, in the order Colt must do them: (1) make a GitHub account and an empty repo named `jarvis`; (2) tell me the repo URL so I can push; (3) make a Railway account; (4) get an Anthropic API key from console.anthropic.com and paste it to me or into Railway; (5) pick a web password; (6) create the Telegram bot with @BotFather and send me the token; (7) get your Telegram user id from @userinfobot; (8) confirm your timezone; (9) open the web link and log in; (10) message the bot. For each step say exactly what to click and what to copy.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add Colt's setup checklist"
git push
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| TypeScript/Node, Agent SDK, models | Global Constraints, Task 1, Task 7 |
| Railway hosting + Postgres | Task 3, Task 12, Task 13 |
| Db in Postgres, no local source of truth (PGlite only local/dev) | Task 3 |
| The brain wraps Agent SDK, surface-agnostic | Task 7 |
| Memory: conversations, messages, long-term facts, keyword retrieval | Task 4 |
| Shared memory across surfaces | Task 7 (test), Task 13 (e2e) |
| Surface adapters: Telegram (phone app), web chat (password) | Task 9, Task 10 |
| Action gate: one system, tiers 0/1/2, held rows, approve from any surface | Task 5, Task 6, Task 9, Task 10 |
| Tier 2 never pre/batch-approved | Task 5 (`approve` re-checks state; no bulk path), Global Constraints |
| Scheduler: 60s loop, due selection, Colt-set reminders | Task 11 |
| Data model tables | Task 3 (`001_init.sql`) |
| Config via env, `.env.example`, `.env` gitignored | Task 1, Task 2, `.gitignore` (exists) |
| Security: single user, Telegram owner check, web password, workspace sandbox | Task 2, Task 9, Task 10, Task 7 (`cwd`) |
| Testing: unit for gate/memory/scheduler/adapters, fake model client, e2e | Tasks 4/5/9/10/11 unit, Task 7 `FakeRunner`, Task 13 e2e |
| CLAUDE.md documents architecture and how to extend | Task 12 |
| "Phase 1 done means" checklist | Tasks 12–13 cover every bullet |
| Colt-facing ordered setup checklist | Task 13 |

No gaps found.

**2. Placeholder scan**

`send_test_message` / `spend_test` return strings described as "(placeholder)" — this is intentional and spec-sanctioned (real messaging is Phase 2, real spend is Phase 5); they are complete, working tier-1/tier-2 demo actions, not unfinished code. The `sdkRunner.ts` implementation note asks the executor to confirm one SDK code path against the installed package — acceptable because the exact `query()` tool-permission surface must be verified at build time and the `ModelRunner` interface isolates it. No "TODO", no "add error handling", no untested code blocks.

**3. Type consistency**

- `Db.query` signature identical across Task 3 definition and all callers.
- `Action` / `ActionResult` / `ActionContext` / `Tier` — defined Task 5, used unchanged in Tasks 6, 7.
- `GateOutcome` kinds (`executed` / `held` / `rejected`) — same in Task 5 impl and Task 7 `onToolAttempt`.
- `ModelRunner.run` / `RunRequest` / `ToolDecision` — defined Task 7 `core/types.ts`, implemented by `FakeRunner` and `SdkRunner`, consumed by `Brain`. Consistent.
- `Surface` (`name` / `start` / `stop` / `send`) — defined Task 8, implemented by `TelegramSurface` (Task 9) and `WebSurface` (Task 10), consumed by `SurfaceRegistry` and `server.ts`.
- `MemoryRepo` method names (`ensureUser`, `getOrCreateConversation`, `addMessage`, `recentMessages`, `addMemory`, `searchMemories`) — consistent between Task 4 definition and Tasks 6/7/12 use.
- Scheduler `deliver` signature matches `SurfaceRegistry.deliver` shape (`{userId, surface, text}`) — Task 11 and Task 12.

No inconsistencies found.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-01-jarvis-phase-1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
