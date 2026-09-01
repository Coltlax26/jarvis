import { z } from "zod";
import type { MemoryRepo } from "../../memory/repo.js";
import type { Action } from "../types.js";

export function rememberAction(
  memory: MemoryRepo
): Action<{ content: string; keywords?: string[] }> {
  return {
    name: "remember",
    tier: 0,
    description:
      "Save a durable fact about Colt, his preferences, people, or projects.",
    schema: z.object({
      content: z.string().min(3),
      keywords: z.array(z.string()).optional(),
    }),
    summarize: (i) => `remember: ${i.content}`,
    run: async (i, ctx) => {
      await memory.addMemory({
        userId: ctx.userId,
        content: i.content,
        keywords: i.keywords,
      });
      return { ok: true, message: "Saved." };
    },
  };
}
