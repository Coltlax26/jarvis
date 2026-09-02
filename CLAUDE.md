# Jarvis

Jarvis is Colt's personal AI assistant. It **runs on Colt's Mac** (see
`docs/RUNNING-LOCALLY.md`), reachable via the web console and Telegram, with
one shared memory. Full design: `docs/superpowers/specs/2026-09-01-jarvis-design.md`.

This project is standalone. It has no connection to `~/agent-ops`.

## Stack

- TypeScript on Node 24, ES modules (`"type": "module"`).
- `@anthropic-ai/claude-agent-sdk` (`^0.3.252`) drives the model. It spawns the
  `claude` CLI, which authenticates with Colt's **claude.ai subscription** when
  no `ANTHROPIC_API_KEY` is set — so there's no per-message API cost. Model is
  `JARVIS_MODEL` (default `claude-sonnet-5`).
- Postgres for all state. Locally (the normal case) this is
  `@electric-sql/pglite` — real Postgres compiled to WASM, in-process, at
  `workspace/dev.pglite`. If `DATABASE_URL` is set it uses real Postgres over
  `pg` instead. Same SQL, same schema.
- `vitest` for tests, `tsx` for local dev, plain `tsc` for the build.
- `grammy` for Telegram (long-polling — no public URL needed), `express` +
  `express-session` for the web console.

## Module map

```
src/
  config.ts, logger.ts        typed env config, JSON logger
  db/                          Db interface, PGlite + Postgres backends, migration runner
  memory/                      conversations, messages, long-term memory (keyword search)
  actions/                     the action gate: Action, Tier, ActionGate, ActionRegistry
    builtin/                   remember, set_reminder, and two Phase-1 demo actions
  activity/                    ActivityRepo — a running log of what Jarvis does
  core/                        the brain: prompt building + turn orchestration
    sdkRunner.ts                model calls via the Agent SDK (subscription auth)
    fakeRunner.ts               scripted model for tests — no network
    events.ts                   JarvisBus — in-process pub/sub of turn progress
  settings/                    SettingsRepo — per-user key/value (mechanism kept, no keys yet)
  surfaces/                    Surface interface + registry (route replies by channel)
    telegram/                   Telegram surface (grammy long-polling)
    google/                     Gmail + Calendar (OAuth, GoogleClient, token repo)
    browser/                    Playwright headless browser (browse action) — inert without Chromium
    mac/                        MacControl — open_url / open_app via `open` (darwin only)
    web/                        the web console: /api/*, /auth/google*, /browse/shot/:id
  scheduler/                    reminder delivery loop + calendar-reminder job
  server.ts                    wires everything and boots
migrations/                    numbered .sql files, applied in order at boot
```

## The action tier system

Every capability Jarvis has is a registered `Action` with a tier. This is
the *only* permission system — never add a one-off permission check
somewhere else.

- **Tier 0 — automatic.** Answering, research, drafting text, reading and
  editing files in `workspace/`, reading Gmail/Calendar, opening a URL or app
  on Colt's Mac, proactive notifications to Colt.
- **Tier 1 — draft, needs approval to send.** Anything that messages another
  person, or writes to Gmail/Calendar. Held as a `draft` row until Colt approves.
- **Tier 2 — explicit approval every time, no exceptions.** Spending money,
  reservations, texting anyone other than Colt, deleting or overwriting
  important files, anything irreversible. Never batchable, never pre-approvable.

Colt approves or rejects from any surface: `approve <id>` / `reject <id>` /
`list pending` on Telegram, or the pending-approvals API on the web surface.

## How to add an action

1. Implement the `Action` interface (`src/actions/types.ts`) in its own file
   under `src/actions/builtin/` (or a new folder for a later phase's
   actions): `name`, `tier`, `description`, a zod `schema`, `summarize()`,
   and `run()`.
2. Register it in `registerBuiltins` (or that phase's equivalent).
3. The tier alone decides what happens — you never call the gate yourself
   from inside an action.

## How to add a surface

1. Implement the `Surface` interface (`src/surfaces/types.ts`): `name`,
   `start()`, `stop()`, `send(userId, text)`.
2. Route incoming text to `brain.handle({ userId, surface, text })`.
3. Add it in `server.ts` via `surfaces.add(...)`.

## Running

```bash
cp .env.example .env   # fill in SESSION_SECRET, jarvis-users.json, GOOGLE_*, TELEGRAM_*
npm install
./start.sh             # = caffeinate -s npm run dev ; web console at :3000
```

`npm run dev` / `npm start` load `.env` via `node --env-file-if-exists`. No
`ANTHROPIC_API_KEY` — the `claude` login is the auth. No `DATABASE_URL` — PGlite
persists to `workspace/dev.pglite`. Full guide: `docs/RUNNING-LOCALLY.md`.

## Testing

```bash
npm test        # vitest, all in-process against PGlite — no external services
npm run typecheck
npm run build
```

Model calls are tested with `FakeRunner` (`src/core/fakeRunner.ts`), a
scripted `ModelRunner` that never touches the network. There is no
integration test that calls the real Anthropic API — that is exercised by
hand (`npm run dev`, then talk to it).

## Hosting

Runs on Colt's Mac. It was on Railway (2026-09) but that needed a paid API key
and cost too much — moved local to use the Claude subscription. Telephony
(Twilio voice + SMS) was removed at the same time because it needs public
webhooks a laptop can't serve.

## Users

Multi-user. Each person has their own password, name, optional `persona`
(appended to their system prompt), and optional `telegramId`. Everything —
memory, conversations, reminders, pending actions, activity — is keyed by
`user_id`, so users are fully separate.

- Config: `JARVIS_USERS_FILE` (path to a JSON array — recommended),
  `JARVIS_USERS` (inline JSON), or `WEB_PASSWORD` for a single user.
- Web login matches the password to a user and stores `userId` in the session;
  every route resolves the caller from `req.session.userId`.
- Telegram maps each `telegramId` to its user.

## Theming

Each user has a `theme` in `JARVIS_USERS`: `mode` (`hud` dark cyan default, or
`light`), `accent` (hex), `background` (image URL under `/bg/`), `backgroundFit`
(`watermark` or `cover`), `brand` (text shown by the JARVIS mark), `logo`
(image URL shown in the top bar). `/api/me` returns it; `applyTheme()` in
`app.js` sets `data-theme` + CSS vars. Per-user background images live in
`src/surfaces/web/public/bg/` (git-tracked, copied to `dist/` by the build).

## Security notes

- `TelegramSurface` rejects any chat id that is not mapped to a user. The web
  surface requires a matching password and uses a signed session cookie.
- The Agent SDK's file/shell tools are scoped to `WORKSPACE_DIR`
  (`./workspace` by default), never the repo root.
- **Mac control** (`src/surfaces/mac/`) is the one thing that runs outside that
  sandbox: `open_url` (https only) and `open_app` (name regex), both via
  `execFile("open", …)` — argv array, no shell. Tier 0. Add nothing here that
  runs arbitrary commands or opens arbitrary paths.
- All secrets come from `.env` / `jarvis-users.json`, both gitignored.
