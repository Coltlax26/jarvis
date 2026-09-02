import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";
import type { Db } from "../db/index.js";
import type { GoogleClient } from "../surfaces/google/client.js";
import type { GoogleTokenRepo } from "../surfaces/google/repo.js";

/**
 * Polls each connected user's calendar and drops a "starts in ~15 minutes"
 * reminder into `scheduled_messages`. Dedupes by `source = calendar:<eventId>`.
 */
export class CalendarReminderJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private deps: {
      db: Db;
      google: GoogleClient;
      tokens: GoogleTokenRepo;
      /** How to deliver the nudge for a user — "telegram" if they have it, else "web". */
      channelFor?: (userId: string) => "telegram" | "web";
      leadMinutes?: number;
      intervalMs?: number;
    }
  ) {}

  async tick(now: Date = new Date()): Promise<number> {
    const lead = (this.deps.leadMinutes ?? 15) * 60_000;
    const users = await this.deps.tokens.connectedUserIds();
    let made = 0;
    for (const userId of users) {
      const events = await this.deps.google.safeListEvents(userId, {
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + lead + 60_000).toISOString(),
      });
      for (const ev of events) {
        if (!ev.start) continue;
        const startsAt = new Date(ev.start).getTime();
        if (Number.isNaN(startsAt)) continue;
        if (startsAt <= now.getTime()) continue; // already started
        // Deliver at lead time, or right away if that moment has passed.
        const deliverAt = new Date(Math.max(now.getTime(), startsAt - lead));
        const source = `calendar:${ev.id}`;
        const { rows } = await this.deps.db.query<{ one: number }>(
          `select 1 as one from scheduled_messages where user_id = $1 and source = $2`,
          [userId, source]
        );
        if (rows.length) continue;
        const channel = this.deps.channelFor?.(userId) ?? "web";
        await this.deps.db.query(
          `insert into scheduled_messages (id, user_id, deliver_at, body, source, channel)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            randomUUID(),
            userId,
            deliverAt.toISOString(),
            `"${ev.summary}" starts in ${this.deps.leadMinutes ?? 15} minutes${ev.location ? ` at ${ev.location}` : ""}.`,
            source,
            channel,
          ]
        );
        made++;
      }
    }
    if (made) logger.info("calendar reminders scheduled", { made });
    return made;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => logger.error("calendar reminder tick failed", err));
    }, this.deps.intervalMs ?? 5 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
