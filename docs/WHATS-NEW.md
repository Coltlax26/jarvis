# What's new — 2026-09-02

Jarvis runs on your Mac (free, your Claude subscription). Web console at
http://localhost:3000, Telegram from your phone. `./start.sh` to run it.

## New this session

### Brain tab
Rename of the Memory tab. Two things:
- **Standing instructions** — a box where you tell Jarvis how to work (style,
  what to focus on, rules). It's added to *every* reply. Saves as you type.
- **What Jarvis knows** — the facts it remembers about you. Add one in the box,
  or delete any with the ×. It already has your business profile loaded.

### Prospects tab — your sales pipeline
Businesses to pitch a website to.
- Ask Jarvis: *"find me 10 businesses in Emmaus without a website"* → it
  searches, checks each one, and drops them here automatically.
- Each row has status chips: **new → contacted → interested → quoted →
  won / lost**. Click to move a prospect along. Tell Jarvis "mark Kline HVAC as
  contacted" and it updates too.
- Quick-add form for ones you find yourself.

### Lead-gen is baked in
Jarvis now has a method: search by business type + town, check for a real
website (Facebook-only / Yelp-only counts as "no website"), prioritize
established businesses with no web presence, save every one to the pipeline,
and hand you a table. Just say "find leads".

### Calendar
- Jarvis can now **delete** events (asks first).
- The "starts in 15 minutes" nudge goes to **Telegram** now, so you get it even
  when the console is closed.

### Under the hood
- `browse` (Jarvis's headless browser) no longer asks for approval on every
  page — it's read-only, and lead-gen needs to check many pages fast.

## To try

1. Open the **Brain** tab — check your profile facts, add a standing
   instruction if you want.
2. Open **Prospects**, ask Jarvis to find some leads, watch them land.
3. Work a prospect: "mark [name] contacted", "what's in my pipeline".
