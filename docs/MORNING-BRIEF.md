# Morning brief — overnight build

_Running log. Newest status at the top of each section._

## TL;DR

Overnight autonomous build against `~/.claude/plans/streamed-prancing-truffle.md`.
`main` stays green + deployed after every item.

Live URL: https://web-production-a733d.up.railway.app

## Shipped & deployed

| # | Item | Status | Commit |
|---|------|--------|--------|
| 1 | Voice speed — `DirectRunner` (no subprocess, ~1–3s replies) | ✅ live | ffe5a4b |
| 2 | Voice settings panel (Settings tab, live-editable) | ✅ live | 41a7ef2 |
| 3 | ElevenLabs voice engine (natural TTS, `<Play>` mp3) | ✅ live | 45d50e4 |
| 4 | `place_call` Tier-2 action — Jarvis phones other people | ✅ live | 238309b |
| 5 | Gmail + Calendar actions | ✅ **live & connected** | 0570376 |
| 6 | `browse` Tier-2 action (headless browser) — code only | ✅ live, inert | 1dbfe50 |
| — | Fix: Telegram 409 was crashing every deploy | ✅ live | b3e31ba |

### Item 6 notes
- The `browse` action + `BrowserRunner` (via `playwright-core`, no bundled
  browser download) are deployed but **inert** — `browser groundwork
  chromium=false` in the logs, because Railway's container has no Chromium.
- `browse({url})` is Tier 2. When a browser is present it loads the page with a
  real JS engine, returns the rendered text, and streams a screenshot to the
  console at an authed `/browse/shot/:id.png` URL.
- **Deferred to you:** installing Chromium on Railway. I tried a `nixpacks.toml`
  with `aptPkgs = ["chromium", ...]` and two deploys failed (the image balloons;
  also compounded by the Telegram bug below). The plan said to stop at the code
  if the browser won't install cleanly — so it's reverted. Options for the
  morning: (a) switch the Railway build to a Dockerfile on
  `mcr.microsoft.com/playwright:v1.x-jammy`; (b) retry `nixpacks.toml` now that
  the Telegram crash is fixed; (c) leave `browse` for a later phase. Low
  urgency.

### Fix: Telegram 409 crash (b3e31ba)
- **This was breaking every deploy, not just item 6.** grammy's `bot.start()`
  rejects with a 409 when the previous instance still holds the Telegram
  long-poll during a rolling deploy. It was run as `void bot.start(...)`, so the
  rejection was unhandled and Node exited. Older deploys got lucky on a restart;
  item 6 crash-looped past Railway's 10-retry limit and the deploy was marked
  failed.
- Now: `bot.catch()` for handler errors, `runPolling()` retries `start()` with
  backoff on transient failures, and a process-level `unhandledRejection` guard.
  Deploy logs now show `telegram polling stopped; retrying … → telegram polling
  started` and the process stays up.

### Item 5 notes
- **Done and verified live 2026-09-02** — Google Cloud project set up, Colt
  connected his account (petersonsales42@gmail.com), inbox + calendar reads
  confirmed working in the console.
- Consent screen is in **Testing mode**, which means Google expires the
  connection after ~7 days — you'll need to re-click "Connect Google" in
  Settings about once a week. To make it permanent we'd add a privacy-policy
  page to Jarvis and publish the app (small follow-up, noted below).
- Also fixed a bug found during testing: read-type actions (inbox, calendar)
  weren't handing their results back to the model. Fixed in `b9ee99b`.
- Once connected: **read_inbox** and **list_events** are Tier 0 (Jarvis just
  does them); **draft_email**, **add_event**, **move_event** are Tier 1 (held
  for your approval). Drafts are saved to Gmail, never sent.
- A background job checks connected calendars every 5 min and gives you a
  "*'Meeting' starts in 15 minutes*" nudge in the console.
- **Connect Google** button is in the Settings tab (shows "not configured"
  until the env vars are set).
- Setup walkthrough is in the morning tasks below.

### Item 4 notes
- Ask Jarvis (any surface) to call someone: "call the pizza place at 610-555-0000
  and order a large pepperoni". It creates a **Tier-2** pending action — you
  approve it (`approve <id>` on Telegram, or the pending list on the web) and
  then it dials out.
- The call runs on the fast voice model with a per-call brief ("you're
  representing Colt, your goal is X"), **no tools** — it just talks. Hangs up
  when the goal is met or the other side ends it.
- Live transcript streams to your console (call banner + Voice tab, same as
  inbound). A **"Calls Jarvis placed"** list on the Voice tab shows history with
  the last few lines of each.
- `voice_calls` table added (migration 007, applied on deploy — logs confirm
  `applied=["007_voice_calls.sql"]`).
- (The grammy-409-on-deploy wart mentioned earlier is now **fixed** — see the
  Telegram fix entry above.)

### Item 3 notes
- New **Voice engine** dropdown in Settings: `Twilio` (built-in, instant) or
  `ElevenLabs` (natural, needs key). ElevenLabs is the default when a key is set.
- Optional **ElevenLabs voice ID** field — blank uses "Daniel" (British male,
  closest to the movie JARVIS), id `onwK4e9ZLuTAKqWW03F9`.
- Generated audio is served at `/voice/audio/:id.mp3` — random UUID, 3-minute
  TTL, in-memory only. Falls back to `<Say>` automatically if synthesis fails.
- `ELEVENLABS_API_KEY` is already set in Railway; deploy logs confirm
  `voice surface ready ... elevenlabs=true`.

## Build summary

All 7 planned items are done. Items 1–5 are fully live and working (Gmail +
Calendar connected the morning of 2026-09-02). Item 6 (`browse`) ships its code
live but inert — it needs Chromium in the container. A latent Telegram crash
that was failing deploys got found and fixed, and a bug where read actions
didn't return their results to the model was fixed after Google went live.

Final state of `main`: `npm test` (92 passing), `npm run build`, `npm run
typecheck` all green. Deployed and healthy at
https://web-production-a733d.up.railway.app/health.

## Needs your action

1. **Railway trial credit is low (~$4.97 when checked at ~3am).** Add a payment
   method or the service will stop. Railway dashboard → project
   `helpful-gentleness` → Usage. **This is the most important one** — everything
   above goes offline without it.
2. **Twilio "call status" webhook** — set it so the Voice tab knows when an
   *inbound* call ends: Twilio console → Phone Numbers → +1 610 571 8533 → Voice
   → "A call status changes" →
   `https://web-production-a733d.up.railway.app/twilio/voice/status` (HTTP POST).
   (Outbound `place_call` sets its own status callback automatically — no config
   needed there.)
3. **Rich's phone number** — not yet added to `JARVIS_USERS`. Add via the
   settings/DB (blocked from doing it via CLI because it needs the password in
   the command). His number: +1 484 880 9096.
4. **Google Cloud / Gmail + Calendar — DONE.** Set up and connected on
   2026-09-02. Only lingering item: the consent screen is in "Testing" mode so
   the connection drops after ~7 days and you re-click "Connect Google" in
   Settings. To kill that: add a privacy page to Jarvis and publish the Google
   app (small follow-up).
5. **(Optional) Chromium for the `browse` action** — see the Item 6 notes above.
   Low urgency; fine to leave for a later phase.
6. **(Optional) Obsidian integration** — you asked about this; parked as a
   future phase, see the Roadmap section.

## Roadmap — parked ideas

### Obsidian integration (future phase)
Obsidian is a local Markdown notes app; its files are just `.md` in a folder, so
an agent can read and write them directly. Useful for Jarvis:
- **A shared knowledge base** — Jarvis writes research, meeting notes, project
  docs, and your "remember this" facts into your vault as linked Markdown you
  can browse and edit in Obsidian.
- **Website / project work** — when Jarvis builds a site or app for you, the
  spec, plan, and notes live in the vault; you review and edit them in Obsidian
  and Jarvis picks up your changes.
- **Daily notes** — Jarvis appends to a daily note (calls made, emails drafted,
  reminders set) so there's a readable log outside the console.

How: either sync a vault folder into Jarvis's workspace (Git or a cloud drive),
or run a small local "bridge" so Jarvis on Railway can reach the vault on your
Mac. Not started — revisit once the core is solid.

## How to test each capability

- **Voice speed / engine:** call +1 610 571 8533, speak a question. Reply should
  come in ~1–3s. In an ElevenLabs-natural voice if the engine is set to
  ElevenLabs in Settings.
- **Settings panel:** log in → Settings tab → change the greeting → save → call
  in; the new greeting plays with no redeploy.
- **place_call:** verify your own cell in Twilio first (trial numbers only reach
  verified numbers — you have $20 balance so this may be lifted). Then message
  Jarvis: "call +1 XXX XXX XXXX and tell them this is a test, then hang up".
  Approve the pending action. Watch the Voice tab for the live transcript.
- **Gmail / Calendar:** after connecting Google, ask "what's in my inbox?" and
  "what's on my calendar this week?" (both answer immediately). Then "draft a
  reply to the last email saying I'll get back to them Monday" — it appears as a
  pending Tier-1 action; approve it and check Gmail's Drafts folder.
