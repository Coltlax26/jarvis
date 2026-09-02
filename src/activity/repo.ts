import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";

export type ActivityKind =
  | "message_in"
  | "reply"
  | "action_run"
  | "action_held"
  | "action_approved"
  | "action_rejected"
  | "reminder_sent"
  | "call_started"
  | "call_ended"
  | "error";

export type ActivityEntry = {
  id: string;
  userId: string;
  kind: ActivityKind;
  summary: string;
  detail: unknown;
  createdAt: Date;
};

export class ActivityRepo {
  constructor(private db: Db) {}

  async log(e: {
    userId: string;
    kind: ActivityKind;
    summary: string;
    detail?: unknown;
  }): Promise<void> {
    await this.db.query(
      `insert into activity (id, user_id, kind, summary, detail)
       values ($1,$2,$3,$4,$5)`,
      [
        randomUUID(),
        e.userId,
        e.kind,
        e.summary.slice(0, 500),
        e.detail === undefined ? null : JSON.stringify(e.detail),
      ]
    );
  }

  async recent(userId: string, limit = 50): Promise<ActivityEntry[]> {
    const n = Math.max(1, Math.min(200, Math.floor(limit)));
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from activity where user_id = $1 order by created_at desc limit ${n}`,
      [userId]
    );
    return rows.map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      kind: r.kind as ActivityKind,
      summary: r.summary as string,
      detail:
        typeof r.detail === "string" ? JSON.parse(r.detail) : (r.detail ?? null),
      createdAt: new Date(r.created_at as string),
    }));
  }
}
