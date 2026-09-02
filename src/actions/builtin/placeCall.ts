import { z } from "zod";
import type { Action } from "../types.js";

export type PlaceOutbound = (input: {
  to: string;
  purpose: string;
  ownerId: string;
}) => Promise<{ id: string }>;

const phone = z
  .string()
  .transform((s) => s.replace(/[^\d+]/g, ""))
  .refine((s) => /^\+?\d{10,15}$/.test(s), "must be a phone number")
  .transform((s) => {
    if (s.startsWith("+")) return s;
    if (s.length === 10) return `+1${s}`;
    return `+${s}`;
  });

/**
 * Tier 2 — Jarvis phones another person and carries out a spoken task.
 * `placeOutbound` is supplied by the server (the voice surface); without it
 * the action is inert.
 */
export function placeCallAction(deps: { placeOutbound?: PlaceOutbound }): Action<{
  to: string;
  purpose: string;
}> {
  return {
    name: "place_call",
    tier: 2,
    description:
      "Call another person on the phone on Colt's behalf and carry out a spoken " +
      "task — e.g. book a table, confirm an appointment, ask a business a question. " +
      "`to` is their phone number. `purpose` is what you are trying to accomplish, " +
      "stated plainly. Requires explicit approval every time. Not for calling Colt " +
      "himself (use a voice reminder for that).",
    schema: z.object({
      to: phone,
      purpose: z.string().min(1).max(500),
    }),
    summarize: (i) => `call ${i.to} — ${i.purpose}`,
    run: async (i, ctx) => {
      if (!deps.placeOutbound) {
        return { ok: false, message: "Outbound calling is not configured." };
      }
      const { id } = await deps.placeOutbound({
        to: i.to,
        purpose: i.purpose,
        ownerId: ctx.userId,
      });
      return {
        ok: true,
        message: `Calling ${i.to} now. Watch the Voice tab for the live transcript.`,
        data: { callId: id },
      };
    },
  };
}
