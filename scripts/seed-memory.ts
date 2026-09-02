/**
 * One-off: seed Jarvis's long-term memory with Colt's profile.
 * Run with the server stopped (PGlite is single-connection):
 *   node --env-file-if-exists=.env --import tsx scripts/seed-memory.ts
 */
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { MemoryRepo } from "../src/memory/repo.js";

const FACTS: Record<string, string[]> = {
  colt: [
    "Colt's main business goal: sell website-building services to local businesses that have no website or a weak/outdated one. He cold-calls or emails them, pitches a new site, and closes the deal.",
    "The hardest and most important part of Colt's website business is lead generation — finding local businesses with no real website. He needs Jarvis to be excellent at this: search Google Maps, Google reviews, business directories and the web to surface companies that lack a proper site, then check each one.",
    "Colt's website workflow, in order: (1) Jarvis finds leads, (2) Colt pitches and sells, (3) Jarvis builds the full website, (4) Jarvis gives Colt a plain step-by-step walkthrough to get the site hosted for the client.",
    "Colt targets local businesses in the Lehigh Valley, Pennsylvania area (Macungie / Allentown / Emmaus region) for website prospecting, unless he says to look somewhere else.",
    "Colt does high-ticket sales — services, coaching programs, mentorships, B2B and B2C. He is newer to sales and actively building his skills and client base.",
    "Colt is new to business and still learning. When explaining anything, break it into clear numbered steps, define any jargon, and don't assume he has done it before. He wants to be coached, not just given an answer.",
    "Colt's communication preference: direct and plain, short where possible, but always explained clearly enough that he can follow and act on it. He has said he's 'not the smartest' — never talk down, always make it understandable.",
    "Colt uses Wix to build websites (he has a Wix account).",
    "Colt currently works at Salvatore's Pizzeria in Macungie, PA — a day job while he builds his website and sales business.",
    "Colt's dad is Rich Peterson, who runs Peterson Sales — high-ticket construction sales (large residential and commercial jobs). Colt is learning the sales trade partly from Rich.",
    "Colt wants Jarvis to draft emails for him (he reviews and sends them himself), manage his Google Calendar — add events, delete events — and proactively remind him before calendar events.",
    "Colt wants Jarvis to be a full general-purpose assistant: answer school questions, general questions, research, anything he asks. In his words, 'my own Claude agent that can do anything I want it to do.'",
    "When Colt asks Jarvis to find website leads, Jarvis should return a concrete list: business name, what they do, town, phone if found, and whether they appear to have a website — not a vague summary.",
  ],
};

async function main() {
  const config = loadConfig();
  const db = await createDb({
    databaseUrl: config.databaseUrl,
    pgliteDir: config.databaseUrl ? undefined : `${config.workspaceDir}/dev.pglite`,
  });
  await runMigrations(db);
  const memory = new MemoryRepo(db);

  for (const user of config.users) {
    const facts = FACTS[user.id];
    if (!facts) continue;
    await memory.ensureUser(user.id, user.name, user.persona);
    const existing = await memory.listMemories(user.id, 500);
    let added = 0;
    for (const content of facts) {
      const dup = existing.some(
        (m) => m.content.slice(0, 40) === content.slice(0, 40)
      );
      if (dup) continue;
      await memory.addMemory({ userId: user.id, content, source: "profile-seed" });
      added++;
    }
    console.log(`${user.name}: +${added} memories (${existing.length} already there)`);
  }
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
