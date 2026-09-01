# Getting Jarvis online

Do these in order. Each one is small. Tell me when you finish a step, or if
something on screen does not match what I describe.

## 1. Make a GitHub account (if you don't have one)

Go to github.com and sign up. Free is fine.

## 2. Create an empty repository named `jarvis`

On github.com click the `+` in the top right, then "New repository". Name it
`jarvis`. Leave it empty (no README, no .gitignore). Click "Create
repository". Copy the URL it shows you (looks like
`https://github.com/yourname/jarvis.git`) and give it to me. I will push the
code.

## 3. Make a Railway account

Go to railway.app and sign up. You can use your GitHub account to sign in,
which is easiest.

## 4. Get an Anthropic API key

Go to console.anthropic.com. Sign up or log in. Go to "API Keys" and create
one. Copy it — it starts with `sk-ant-`. Keep this private, like a password.
You will paste it into Railway in step 7.

## 5. Pick a web password

This is the password you will use to open Jarvis's chat page in a browser.
Pick something only you know. You will type it into Railway in step 7.

## 6. Create the Telegram bot

This is the phone app you will use to talk to Jarvis.

1. Open Telegram (install the app if you don't have it).
2. Search for the user `@BotFather` and open a chat with it.
3. Send `/newbot`.
4. Give it a name (anything, e.g. "Jarvis").
5. Give it a username ending in `bot` (e.g. `colt_jarvis_bot`).
6. BotFather replies with a token, a long string of letters and numbers.
   Copy it and give it to me, or save it for step 7.
7. Search for `@userinfobot` in Telegram, open a chat, and send any message.
   It replies with your numeric user ID. Copy that too.

## 7. Set up the Railway project (I do the clicking with you)

In Railway: New Project → Deploy from GitHub repo → pick `jarvis`. Then:

- New → Database → Add PostgreSQL (Railway wires this up automatically).
- Go to your app's "Variables" tab and add:
  - `ANTHROPIC_API_KEY` — from step 4
  - `WEB_PASSWORD` — from step 5
  - `SESSION_SECRET` — any long random string (I can generate one for you)
  - `TZ` — your timezone, e.g. `America/Denver`
  - `TELEGRAM_BOT_TOKEN` — from step 6
  - `OWNER_TELEGRAM_ID` — from step 6
- Settings → Networking → "Generate Domain". Copy the URL it gives you and
  add one more variable: `PUBLIC_URL` set to that URL (starting with
  `https://`).

## 8. Check it works

- Open the Railway URL from step 7 in your browser. Log in with your web
  password. Say hello.
- Open Telegram, find your bot, and say hello there too.
- Ask it something on one and check the other remembers it — that's the
  shared memory working.

## 9. If something is stuck

Tell me what you see (a screenshot helps) and I'll fix it. Common ones:

- Blank page or "not found": the deploy is probably still building — wait a
  minute and refresh.
- "wrong password": check `WEB_PASSWORD` in Railway matches what you typed.
- Telegram bot doesn't respond: check `TELEGRAM_BOT_TOKEN` and
  `OWNER_TELEGRAM_ID` are both set correctly, and that you're messaging the
  right bot.
