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

- Item 5 — Gmail + Calendar (code ships inert; needs Google Cloud OAuth in the
  morning — ~15 min walkthrough).
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
   (Gmail/Calendar). Walkthrough in the morning.

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
