import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../../db/index.js";
import type { Action } from "../types.js";

export function setReminderAction(
  db: Db
): Action<{ deliverAt: string; body: string }> {
  return {
    name: "set_reminder",
    tier: 0,
    description:
      "Schedule a proactive message to Colt at a specific time. deliverAt must be an ISO 8601 timestamp.",
    schema: z.object({
      deliverAt: z
        .string()
        .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO timestamp"),
      body: z.string().min(1),
    }),
    summarize: (i) => `reminder @ ${i.deliverAt}: ${i.body}`,
    run: async (i, ctx) => {
      await db.query(
        `insert into scheduled_messages (id, user_id, deliver_at, body, source)
         values ($1,$2,$3,$4,'reminder')`,
        [randomUUID(), ctx.userId, new Date(i.deliverAt).toISOString(), i.body]
      );
      return { ok: true, message: `Reminder set for ${i.deliverAt}.` };
    },
  };
}
