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
- Known wart (pre-existing, self-heals): during each deploy the old and new
  instances briefly both poll Telegram; the losing one crashes with a grammy
  409 and Railway restarts it. No action needed, but worth knowing.

### Item 3 notes
- New **Voice engine** dropdown in Settings: `Twilio` (built-in, instant) or
  `ElevenLabs` (natural, needs key). ElevenLabs is the default when a key is set.
- Optional **ElevenLabs voice ID** field — blank uses "Daniel" (British male,
  closest to the movie JARVIS), id `onwK4e9ZLuTAKqWW03F9`.
- Generated audio is served at `/voice/audio/:id.mp3` — random UUID, 3-minute
  TTL, in-memory only. Falls back to `<Say>` automatically if synthesis fails.
- `ELEVENLABS_API_KEY` is already set in Railway; deploy logs confirm
  `voice surface ready ... elevenlabs=true`.

## Still in progress / queued tonight

- Item 6 — `browse` Tier-2 action (Playwright headless browser).
- Item 7 — polish + this brief finalised.

## Needs your action in the morning

1. **Railway trial credit is low (~$4.97 when checked).** Add a payment method
   or the service will stop. Railway dashboard → project `helpful-gentleness`
   → Usage.
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
