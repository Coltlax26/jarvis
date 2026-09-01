import { z } from "zod";
import type { Action } from "../types.js";

export function sendTestMessageAction(): Action<{ to: string; text: string }> {
  return {
    name: "send_test_message",
    tier: 1,
    description:
      "Draft a message to another person. Held for Colt's approval. Real delivery arrives in Phase 2.",
    schema: z.object({ to: z.string().min(1), text: z.string().min(1) }),
    summarize: (i) => `message to ${i.to}: ${i.text}`,
    run: async (i) => ({
      ok: true,
      message: `(placeholder) would send to ${i.to}: "${i.text}"`,
    }),
  };
}
