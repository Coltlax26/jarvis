# Jarvis

Jarvis is Colt's personal AI assistant. One always-on process, one shared
memory, several ways in. Full design: `docs/superpowers/specs/2026-09-01-jarvis-design.md`.
Phase 1 build plan: `docs/superpowers/plans/2026-09-01-jarvis-phase-1.md`.

This project is standalone. It has no connection to `~/agent-ops`.

## Stack

- TypeScript on Node 24, ES modules (`"type": "module"`).
- `@anthropic-ai/claude-agent-sdk` (installed version: see `package.json` —
  pinned at `^0.3.252` as of Phase 1) drives the model. Main model
  `claude-opus-5`, background/cheap jobs use `claude-haiku-4-5` (not wired to
  anything yet in Phase 1).
- Postgres for all state. Locally and in tests this runs as
  `@electric-sql/pglite` (real Postgres compiled to WASM, in-process, no
  install needed). In production, `DATABASE_URL` (set by Railway) switches
  to real Postgres over `pg`. Same SQL, same schema, both paths.
- `vitest` for tests, `tsx` for local dev, plain `tsc` for the production
  build.
- `grammy` for Telegram, `express` + `express-session` for the web chat page.

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
    sdkRunner.ts                real model calls via the Agent SDK
    fakeRunner.ts               scripted model for tests — no network, no API key
    events.ts                   JarvisBus — in-process pub/sub of turn progress
  surfaces/                    Surface interface + registry (route replies by channel)
    telegram/                   Telegram surface
    twilio/                     Twilio clients: TwilioClient (SMS), TwilioVoiceClient
                                (calls + TwiML), shared signature.ts
    voice/                      VoiceSurface — inbound calls (greeting + Gather turn
                                loop, POST /twilio/voice[/turn]), outbound announce
                                calls (send()), TTS voice Polly.Brian-Neural
    web/                        the web console + all Twilio webhooks (form-encoded,
                                signature-verified): /twilio/sms, /twilio/voice[/turn],
                                /twilio/voice/announce
  scheduler/                    60s loop that delivers due reminders
  server.ts                    wires everything and boots
migrations/                    numbered .sql files, applied in order at boot
```

## The action tier system

Every capability Jarvis has is a registered `Action` with a tier. This is
the *only* permission system — never add a one-off permission check
somewhere else.

- **Tier 0 — automatic.** Answering, research, drafting text, reading and
  editing files in `workspace/`, proactive notifications to Colt.
- **Tier 1 — draft, needs approval to send.** Anything that messages another
  person. Held as a `draft` row until Colt approves.
- **Tier 2 — explicit approval every time, no exceptions.** Spending money,
  reservations, calling or texting anyone other than Colt, deleting or
  overwriting important files, anything irreversible. Never batchable, never
  pre-approvable.

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

## Running locally

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY, WEB_PASSWORD, SESSION_SECRET
npm install
npm run dev
```

No `DATABASE_URL` needed locally — PGlite persists to `workspace/dev.pglite`.

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

## Deploying

Railway, via `railway.json` (Nixpacks build, `npm start`). Add a Postgres
database in the same Railway project — `DATABASE_URL` is then set
automatically. See `docs/SETUP.md` for the full one-step-at-a-time checklist.

## Users

Multi-user. Each person has their own password, name, optional `persona`
(appended to their system prompt), and optional `telegramId`. Everything —
memory, conversations, reminders, pending actions, activity — is keyed by
`user_id`, so users are fully separate.

- Config: `JARVIS_USERS` (JSON array) for multiple people, or `WEB_PASSWORD`
  (+ `WEB_USER_NAME` / `WEB_USER_PERSONA`) for a single user. See `.env.example`.
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
- All secrets come from environment variables. `.env` is gitignored —
  never commit a real key.
