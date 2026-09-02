import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../../db/index.js";
import type { Action } from "../types.js";

export function setReminderAction(
  db: Db
): Action<{ deliverAt: string; body: string; channel?: "web" | "telegram" }> {
  return {
    name: "set_reminder",
    tier: 0,
    description:
      "Schedule a proactive message at a specific time. deliverAt must be an ISO 8601 " +
      "timestamp. channel is 'web' (shows in the console, default) or 'telegram' " +
      "(sent as a Telegram message).",
    schema: z.object({
      deliverAt: z
        .string()
        .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO timestamp"),
      body: z.string().min(1),
      channel: z.enum(["web", "telegram"]).optional(),
    }),
    summarize: (i) => `reminder @ ${i.deliverAt} (${i.channel ?? "web"}): ${i.body}`,
    run: async (i, ctx) => {
      await db.query(
        `insert into scheduled_messages (id, user_id, deliver_at, body, source, channel)
         values ($1,$2,$3,$4,'reminder',$5)`,
        [
          randomUUID(),
          ctx.userId,
          new Date(i.deliverAt).toISOString(),
          i.body,
          i.channel ?? "web",
        ]
      );
      return { ok: true, message: `Reminder set for ${i.deliverAt}.` };
    },
  };
}
