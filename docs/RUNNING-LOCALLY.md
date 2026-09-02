# Running Jarvis on your Mac

Jarvis runs as a normal program on your Mac. It uses your **Claude
subscription** (via the `claude` CLI login) instead of a paid API key, so
talking to it costs nothing extra.

## Start it

```
./start.sh
```

or double-click `start.sh` in Finder. Leave the Terminal window open. It:

- keeps your Mac awake while it runs (`caffeinate`),
- serves the web console at **http://localhost:3000**,
- connects the Telegram bot.

Press **Ctrl-C** in that window to stop.

## What works when

| | Needs the Mac awake + `start.sh` running? |
|---|---|
| **Telegram** (text Jarvis from your phone) | **No** — works whenever the Mac is running it, and the bot keeps its place |
| **Web console** (localhost:3000) | Yes |
| **"Open my calendar" / open apps on the Mac** | Yes |
| **Gmail / Calendar reads** | Yes (needs the console running) |

So: keep `start.sh` running when you want the web console or Mac control.
Telegram just needs the Mac on and the program running.

## First-time setup

1. **Claude login** — you already have this if you use Claude Code. Check with
   `claude` in a terminal; if it asks you to log in, do that (pick "Claude
   account", not an API key).
2. **`.env`** — copy `.env.example` to `.env` and fill it in. Users go in
   `jarvis-users.json` (see `.env.example`).
3. **Install + run**:
   ```
   npm install
   ./start.sh
   ```
4. Open http://localhost:3000, log in with your password.
5. **Google** (optional) — Settings tab → Connect Google → approve.

## Cost

- **Chat / Telegram / Mac control** — free (your Claude subscription).
- Heavy use counts against your plan's usage limits like normal Claude use.
  If you ever hit them, set `JARVIS_MODEL=claude-haiku-4-5` in `.env` to use
  less per message.

## Model

`JARVIS_MODEL` in `.env` picks the model — `claude-sonnet-5` (default, smart)
or `claude-haiku-4-5` (lighter). Restart `start.sh` after changing it.
