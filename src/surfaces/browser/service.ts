import { randomUUID } from "node:crypto";
import type { JarvisBus } from "../../core/events.js";
import { BrowserUnavailableError, type BrowseResult } from "./runner.js";

export type BrowserLike = {
  available(): boolean;
  browse(url: string, opts?: { waitMs?: number; maxChars?: number }): Promise<BrowseResult>;
};

export type BrowseOutcome = {
  ok: boolean;
  message: string;
  data?: {
    title: string;
    finalUrl: string;
    text: string;
    screenshotUrl: string | null;
  };
};

/**
 * Wraps BrowserRunner: runs a page load, stashes the screenshot behind a
 * short-lived URL, and streams a `browse` event to the owner's console.
 */
export class BrowseService {
  private shots = new Map<string, { png: Buffer; expires: number }>();

  constructor(
    private deps: {
      runner: BrowserLike;
      publicUrl: string;
      bus?: JarvisBus;
    }
  ) {}

  available(): boolean {
    return this.deps.runner.available();
  }

  shotFor(id: string): Buffer | null {
    const s = this.shots.get(id);
    if (!s || s.expires < Date.now()) return null;
    return s.png;
  }

  async run(userId: string, input: { url: string; waitMs?: number }): Promise<BrowseOutcome> {
    if (!this.deps.runner.available()) {
      return {
        ok: false,
        message:
          "My headless browser isn't available on this host yet. The code is deployed; " +
          "it needs Chromium installed in the container (see the morning brief).",
      };
    }
    try {
      const res = await this.deps.runner.browse(input.url, {
        waitMs: input.waitMs,
        maxChars: 6_000,
      });
      let screenshotUrl: string | null = null;
      if (res.screenshot) {
        const id = randomUUID();
        this.shots.set(id, { png: res.screenshot, expires: Date.now() + 10 * 60_000 });
        for (const [k, v] of this.shots) if (v.expires < Date.now()) this.shots.delete(k);
        screenshotUrl = `${this.deps.publicUrl.replace(/\/$/, "")}/browse/shot/${id}.png`;
      }
      this.deps.bus?.publish(userId, {
        kind: "tool_run",
        text: `Browsed ${res.finalUrl}`,
        at: new Date().toISOString(),
        surface: "web",
        data: { browse: { title: res.title, url: res.finalUrl, screenshotUrl } },
      });
      const summary =
        `${res.title || "(no title)"} — ${res.finalUrl}\n\n` +
        res.text.slice(0, 4_000);
      return {
        ok: true,
        message: summary,
        data: { title: res.title, finalUrl: res.finalUrl, text: res.text, screenshotUrl },
      };
    } catch (err) {
      if (err instanceof BrowserUnavailableError) {
        return { ok: false, message: err.message };
      }
      return {
        ok: false,
        message: `Couldn't load that page: ${(err as Error).message}`,
      };
    }
  }
}
