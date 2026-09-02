import { z } from "zod";
import type { Action } from "../types.js";
import type { ActionRegistry } from "../registry.js";

/** The slice of MacControl the actions need — structural, for testing. */
export type MacApi = {
  openUrl(url: string): Promise<void>;
  openApp(name: string): Promise<void>;
};

export function registerMacActions(reg: ActionRegistry, api: MacApi): void {
  reg.register(openUrlAction(api));
  reg.register(openAppAction(api));
}

export function openUrlAction(api: MacApi): Action<{ url: string }> {
  return {
    name: "open_url",
    tier: 0,
    description:
      "Open a web page in Colt's browser on his Mac — e.g. his Google Calendar, " +
      "Gmail, a doc, or a site he asks for. `url` must start with http:// or https://.",
    schema: z.object({ url: z.string().regex(/^https?:\/\//i, "must be an http(s) URL") }),
    summarize: (i) => `open ${i.url}`,
    run: async (i) => {
      try {
        await api.openUrl(i.url);
        return { ok: true, message: `Opened ${i.url} on your Mac.` };
      } catch (err) {
        return { ok: false, message: `Couldn't open that: ${(err as Error).message}` };
      }
    },
  };
}

export function openAppAction(api: MacApi): Action<{ name: string }> {
  return {
    name: "open_app",
    tier: 0,
    description:
      "Open or bring to the front a Mac app by name — e.g. Notes, Safari, " +
      "Messages, Calendar, Music, Finder.",
    schema: z.object({
      name: z.string().regex(/^[A-Za-z0-9 .&'-]{1,50}$/, "app name looks wrong"),
    }),
    summarize: (i) => `open app ${i.name}`,
    run: async (i) => {
      try {
        await api.openApp(i.name);
        return { ok: true, message: `Opened ${i.name} on your Mac.` };
      } catch (err) {
        return { ok: false, message: `Couldn't open ${i.name}: ${(err as Error).message}` };
      }
    },
  };
}
