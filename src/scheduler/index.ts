import { logger } from "../logger.js";
import type { Db } from "../db/index.js";

type DeliverFn = (msg: { userId: string; surface: string; text: string }) => Promise<void>;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private db: Db;
  private deliver: DeliverFn;
  private userId: string;
  private intervalMs: number;

  constructor(opts: { db: Db; deliver: DeliverFn; userId: string; intervalMs?: number }) {
    this.db = opts.db;
    this.deliver = opts.deliver;
    this.userId = opts.userId;
    this.intervalMs = opts.intervalMs ?? 60_000;
  }

  async tick(now: Date = new Date()): Promise<number> {
    const { rows } = await this.db.query<{ id: string; body: string; user_id: string }>(
      `select id, body, user_id from scheduled_messages
       where status = 'pending' and deliver_at <= $1
       order by deliver_at asc limit 20`,
      [now.toISOString()]
    );
    let sent = 0;
    for (const row of rows) {
      try {
        await this.deliver({ userId: row.user_id, surface: "scheduler", text: row.body });
        await this.db.query(`update scheduled_messages set status = 'sent' where id = $1`, [row.id]);
        sent++;
      } catch (err) {
        logger.error("scheduled delivery failed; will retry", err, { id: row.id });
      }
    }
    return sent;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => logger.error("scheduler tick failed", err));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
