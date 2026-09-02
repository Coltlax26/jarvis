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
| 5 | Gmail + Calendar actions (code; needs Google sign-in) | ✅ live, inert | 0570376 |
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
- Ships **inert** — `Google (Gmail + Calendar) disabled` in the deploy logs
  until `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set. Migration 008
  applied.
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

All 7 planned items are done. Items 1–4 are fully live; items 5 and 6 ship their
code live but **inert** (5 needs Google credentials, 6 needs Chromium in the
container) — both by design per the plan. A latent Telegram crash that was
failing deploys got found and fixed along the way.

Final state of `main`: `npm test` (91 passing), `npm run build`, `npm run
typecheck` all green. Deployed and healthy at
https://web-production-a733d.up.railway.app/health.

## Needs your action in the morning

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
4. **Google Cloud project + OAuth consent** — needed to activate item 5
   (Gmail/Calendar). Steps:
   1. console.cloud.google.com → create a project ("Jarvis").
   2. APIs & Services → Enable APIs → enable **Gmail API** and **Google
      Calendar API**.
   3. APIs & Services → OAuth consent screen → External → app name "Jarvis",
      your email as support + developer contact. Add scopes
      `gmail.modify` and `calendar`. Add yourself (and Rich) as **Test users**.
   4. Credentials → Create Credentials → OAuth client ID → **Web application**.
      Authorised redirect URI:
      `https://web-production-a733d.up.railway.app/auth/google/callback`
   5. Copy the client ID + secret. In Railway set `GOOGLE_CLIENT_ID` and
      `GOOGLE_CLIENT_SECRET`, redeploy.
   6. Log into the console → Settings → **Connect Google** → approve.
   (I can do steps 1–5 via your browser in the morning if you'd rather.)
5. **(Optional) Chromium for the `browse` action** — see the Item 6 notes above.
   Low urgency; fine to leave for a later phase.

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
