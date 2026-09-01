# Jarvis — Personal AI Assistant

Design spec. Written 2026-09-01.

## What Jarvis is

A personal AI assistant for one user (Colt). It runs on an always-on cloud
server, keeps one shared memory, and is reachable from several places at once.
Over time it handles email and calendar, does research and writing, helps with
schoolwork, builds and edits code and websites, has its own phone number for
calls and texts, and carries out real-world tasks like reservations.

It is built in phases. This spec covers the whole system at a high level and
Phase 1 in detail. Later phases get their own specs when we reach them.

## Locked decisions

| Choice | Decision | Reason |
|---|---|---|
| Language / runtime | TypeScript on Node 24 | Best library support for every surface. Language does not affect answer quality. |
| Agent core | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) | Supplies the tool loop, context management, subagents, built-in file and shell tools. |
| Main model | `claude-opus-5` | Most capable model. |
| Background model | `claude-haiku-4-5` | Cheap model for small jobs (phrasing a reminder, routing, short summaries). |
| Hosting | Railway | Beginner-friendly. GitHub deploy, managed Postgres, auto-restart. ~$5–10/mo. |
| Database | Postgres (Railway managed) | One store for memory, history, approvals, schedules, contacts. |
| Repo location | `~/jarvis`, own git repo, `main` branch | Standalone. No connection to `~/agent-ops`. |

## Whole-system architecture

One always-on Node process on Railway. Inside it:

### The brain (`src/core/`)

Wraps the Claude Agent SDK. For each incoming message it:

1. Loads recent conversation history and relevant long-term memory from Postgres.
2. Builds the system prompt (who Jarvis is, who Colt is, current date/time,
   available actions and their tiers).
3. Runs the Agent SDK loop with the registered tools.
4. Streams the reply back to the surface the message came from.
5. Writes new history and any learned facts back to Postgres.

The brain is surface-agnostic. It receives a normalized `IncomingMessage` and
returns/streams an `OutgoingMessage`.

### Memory (`src/memory/`, Postgres)

- **Conversations and messages.** Full history, keyed by a single user id for
  now. Every surface shares one conversation thread unless we later split by
  channel.
- **Long-term memory.** Discrete facts Jarvis learns about Colt, his
  preferences, people, and projects. Written by a `remember` tool, retrieved by
  recency plus keyword match for now (vector search can come later without a
  schema change to callers).
- **All memory is in Postgres.** No local files as source of truth, because the
  server can restart or move.

### Surface adapters (`src/surfaces/`)

Each adapter is a thin translator between an outside channel and the brain.

- **Telegram** (`src/surfaces/telegram/`) — a bot via `grammy`. This is the
  phone app: the Telegram app itself. Supports inline buttons for approvals.
- **Web chat** (`src/surfaces/web/`) — a single password-protected page served
  by the same server, plus a small JSON/SSE API. Works on desktop and mobile
  browsers.
- Later phases add SMS, voice, and optionally Slack/Discord as more adapters.
  They do not change the brain.

Adapters convert inbound events to `IncomingMessage { userId, surface, text,
attachments?, replyContext? }` and send `OutgoingMessage { text, buttons?,
attachments? }`.

### The action gate (`src/actions/`)

The single permission system. Used for everything Jarvis can do. No per-feature
permission code anywhere else.

- Every capability is registered as an **Action** with: a name, an input
  schema, a tier, and a `run()` function.
- Tiers:
  - **Tier 0 — automatic.** Answering, research, drafting text, reading and
    editing files in the workspace, proactive notifications to Colt.
  - **Tier 1 — draft, needs approval to send.** Any message to another person.
    Jarvis writes it and holds it. Colt approves from any surface, then it
    sends.
  - **Tier 2 — explicit approval every time, no exceptions.** Spending money,
    reservations, calling or texting anyone other than Colt, deleting or
    overwriting important files, anything irreversible.
- Flow: the brain calls an action through the gate. The gate reads the tier.
  - Tier 0 → `run()` immediately.
  - Tier 1 → create a `pending_action` row with status `draft`, notify Colt,
    return a "held for approval" result to the brain so it can tell Colt.
  - Tier 2 → create a `pending_action` row with status `awaiting_approval`,
    notify Colt, return a "blocked, waiting" result.
- Approvals: a small set of commands understood on every surface — `approve
  <id>`, `reject <id>`, `list pending` — plus tap-buttons on Telegram and web.
  On approval the gate runs `run()` and reports the outcome to Colt.
- `pending_action` rows keep the full input, the tier, the requesting context,
  timestamps, and the final result, so there is always an audit trail.

### The scheduler (`src/scheduler/`)

A single interval loop (every 60s) that:

- Fires due reminders (rows in a `scheduled_messages` table).
- In Phase 1, reminders are only ones Colt sets by asking ("remind me at 4pm").
- From Phase 3, it also reads calendar events and creates reminder rows ahead
  of meetings.
- All scheduler output to Colt is Tier 0 (proactive notification to Colt).

### CLAUDE.md

At the repo root. Documents the architecture, the module layout, the action
tier rules, how to add a surface, how to add an action, and how to run and
deploy. Kept current as each phase lands, so future work plugs in cleanly.

## Data model (Phase 1)

Postgres tables:

- `users` — id, name, notes. One row for now.
- `conversations` — id, user_id, created_at.
- `messages` — id, conversation_id, role (`user` / `assistant` / `system`),
  surface, content, created_at.
- `memories` — id, user_id, content, source, keywords (text[]), created_at,
  last_used_at.
- `pending_actions` — id, user_id, action_name, input (jsonb), tier, status
  (`draft` / `awaiting_approval` / `approved` / `rejected` / `done` / `failed`),
  origin_surface, result (jsonb), created_at, resolved_at.
- `scheduled_messages` — id, user_id, deliver_at, body, source, status
  (`pending` / `sent` / `canceled`), created_at.

Migrations live in `migrations/` and run on boot.

## External services (Phase 1 only)

| Service | What it is for | What Colt provides |
|---|---|---|
| Anthropic API | The model | `ANTHROPIC_API_KEY` |
| Railway | Hosting + Postgres | account; project created during deploy |
| Telegram | The phone-app surface | a bot token from @BotFather |

Web chat needs only a password Colt chooses (`WEB_PASSWORD`).

## Configuration

All secrets via environment variables, documented in `.env.example`:

```
ANTHROPIC_API_KEY=
DATABASE_URL=            # set by Railway
WEB_PASSWORD=            # Colt chooses
TELEGRAM_BOT_TOKEN=
OWNER_TELEGRAM_ID=       # so the bot ignores everyone else
TZ=America/Denver        # Colt's timezone, for reminders
PORT=                    # set by Railway
```

## Security and safety

- Single-user system. Telegram adapter refuses any chat id that is not
  `OWNER_TELEGRAM_ID`. Web is behind `WEB_PASSWORD` with a signed session
  cookie.
- The action gate is the one choke point for anything outward-facing or
  destructive. Tier 2 can never be pre-approved or batched.
- The server binds to Railway's port and is reached over HTTPS (Railway
  provides the certificate).
- Secrets only in Railway's variables, never in the repo. `.env` is
  gitignored.
- Agent SDK file and shell tools are pointed at a dedicated `workspace/`
  directory, not the whole server.

## Testing

- Unit tests (`vitest`) for: the action gate tier logic, memory read/write,
  the scheduler's due-message selection, and each surface adapter's
  normalization.
- A fake in-memory model client so the brain can be tested without calling
  Anthropic.
- One end-to-end test: message in through a fake surface, brain runs with the
  fake model, history and memory rows land in a test Postgres schema.
- Manual check before each deploy: talk to Jarvis on Telegram and the web page,
  confirm shared memory, set a reminder, approve a fake Tier 1 action.

## Phase 1 done means

- `~/jarvis` repo, TypeScript, builds and runs locally against local Postgres.
- CLAUDE.md written.
- Brain answers questions, does research, writes, reads and edits files in
  `workspace/`.
- Memory and history persist and are shared across Telegram and web.
- Action gate works end to end with a demo Tier 1 and Tier 2 action.
- Scheduler delivers a reminder Colt asked for.
- Deployed to Railway, always on, reachable from Telegram and the web page.
- A single ordered checklist of everything Colt must do, one step at a time:
  accounts to make, keys to copy, buttons to click.

## Later phases (summary only — specced when reached)

- **Phase 2** — Twilio phone number, SMS both ways, proactive reminders go
  live. Start the US carrier registration early because it takes days.
- **Phase 3** — Gmail and Google Calendar. Read inbox, draft replies (Tier 1),
  manage events. Calendar feeds the scheduler.
- **Phase 4** — Twilio voice. Jarvis calls Colt, and calls others (Tier 2).
  Voice via ElevenLabs + Whisper or Twilio native.
- **Phase 5** — Playwright browser automation. Reservations, forms, purchases,
  all Tier 2. Optionally add Slack and Discord surfaces.

## Open questions

None blocking Phase 1. Timezone assumed `America/Denver` — correct during
setup if wrong.
