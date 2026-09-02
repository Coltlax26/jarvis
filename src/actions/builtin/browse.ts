import { z } from "zod";
import type { Action } from "../types.js";

export type BrowseApi = {
  run(
    userId: string,
    input: { url: string; waitMs?: number }
  ): Promise<{ ok: boolean; message: string; data?: unknown }>;
};

/**
 * Tier 2 — Jarvis opens a real headless browser, loads a page, and reads it
 * back (JS-rendered content a plain fetch can't see). Screenshot streams to
 * the console. Requires approval every time.
 */
export function browseAction(api: BrowseApi): Action<{ url: string; waitMs?: number }> {
  return {
    name: "browse",
    tier: 2,
    description:
      "Open a web page in Jarvis's own headless browser and read its rendered " +
      "text (use for sites that need JavaScript, or to check whether a business " +
      "has a real website). `url` is the page to load. Requires approval each time.",
    schema: z.object({
      url: z.string().min(3),
      waitMs: z.number().int().min(0).max(8000).optional(),
    }),
    summarize: (i) => `browse ${i.url}`,
    run: async (i, ctx) => {
      const out = await api.run(ctx.userId, i);
      return { ok: out.ok, message: out.message, data: out.data };
    },
  };
}
