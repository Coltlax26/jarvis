import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "../memory/repo.js";
import { GoogleTokenRepo } from "../surfaces/google/repo.js";
import { CalendarReminderJob } from "./calendarReminders.js";
import type { CalendarEvent, GoogleClient } from "../surfaces/google/client.js";

let db: Db;
let tokens: GoogleTokenRepo;

beforeEach(async () => {
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
  tokens = new GoogleTokenRepo(db);
  await tokens.save("colt", { refreshToken: "rt-1" });
});
afterEach(async () => {
  await db.close();
});

function jobWithEvents(events: CalendarEvent[]): CalendarReminderJob {
  const google = {
    safeListEvents: async () => events,
  } as unknown as GoogleClient;
  return new CalendarReminderJob({ db, google, tokens, leadMinutes: 15 });
}

describe("CalendarReminderJob", () => {
  it("schedules a lead-time reminder for an upcoming event, once", async () => {
    const now = new Date("2026-09-03T08:40:00Z");
    const event: CalendarEvent = {
      id: "evt-1",
      summary: "Standup",
      start: "2026-09-03T09:00:00Z",
      end: "2026-09-03T09:15:00Z",
      location: "Zoom",
      htmlLink: null,
    };
    const job = jobWithEvents([event]);
    expect(await job.tick(now)).toBe(1);
    expect(await job.tick(now)).toBe(0); // deduped by source

    const { rows } = await db.query<{ body: string; source: string; deliver_at: string }>(
      `select body, source, deliver_at from scheduled_messages`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("calendar:evt-1");
    expect(rows[0]!.body).toMatch(/Standup.*15 minutes.*Zoom/);
    expect(new Date(rows[0]!.deliver_at).toISOString()).toBe("2026-09-03T08:45:00.000Z");
  });

  it("ignores events with no usable start time", async () => {
    const job = jobWithEvents([
      { id: "x", summary: "TBD", start: null, end: null, location: null, htmlLink: null },
    ]);
    expect(await job.tick(new Date("2026-09-03T08:40:00Z"))).toBe(0);
  });
});
