import { z } from "zod";
import type { Action } from "../types.js";

export function spendTestAction(): Action<{ amountUsd: number; note: string }> {
  return {
    name: "spend_test",
    tier: 2,
    description:
      "Spend money on Colt's behalf. Requires explicit approval every time. Real payments arrive later.",
    schema: z.object({ amountUsd: z.number().positive(), note: z.string().min(1) }),
    summarize: (i) => `spend $${i.amountUsd} — ${i.note}`,
    run: async (i) => ({
      ok: true,
      message: `(placeholder) approved spend of $${i.amountUsd} for ${i.note}`,
    }),
  };
}
