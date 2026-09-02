import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";
import { logger } from "../../logger.js";

const CANDIDATE_PATHS = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter((p): p is string => Boolean(p));

export type BrowseResult = {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  screenshot: Buffer | null;
};

/**
 * Jarvis's own headless browser. Phase 5 groundwork: loads a page with a real
 * (JS-capable) engine and returns its readable text + a screenshot. Degrades
 * to unavailable when no Chromium binary is on the host.
 */
export class BrowserRunner {
  private executablePath: string | null;

  constructor(opts: { executablePath?: string } = {}) {
    const candidates = opts.executablePath
      ? [opts.executablePath]
      : CANDIDATE_PATHS;
    this.executablePath =
      candidates.find((p) => {
        try {
          return existsSync(p);
        } catch {
          return false;
        }
      }) ?? null;
  }

  available(): boolean {
    return this.executablePath != null;
  }

  async browse(
    url: string,
    opts: { waitMs?: number; maxChars?: number } = {}
  ): Promise<BrowseResult> {
    if (!this.executablePath) {
      throw new BrowserUnavailableError();
    }
    const target = normalizeUrl(url);
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        executablePath: this.executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (compatible; JarvisBot/1.0; +https://github.com/Coltlax26/jarvis)",
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (opts.waitMs) await page.waitForTimeout(Math.min(opts.waitMs, 8_000));

      const title = await page.title();
      const rawText = (await page.evaluate(`(() => {
        const drop = document.querySelectorAll("script,style,noscript,svg,template");
        drop.forEach((n) => n.remove());
        return (document.body && document.body.innerText || "").replace(/\\n{3,}/g, "\\n\\n");
      })()`)) as string;
      const text = rawText.trim().slice(0, opts.maxChars ?? 6_000);
      const screenshot = await page
        .screenshot({ type: "png", fullPage: false })
        .catch(() => null);
      const finalUrl = page.url();
      return { url: target, finalUrl, title, text, screenshot };
    } catch (err) {
      logger.error("browse failed", err, { url: target });
      throw err;
    } finally {
      await browser?.close().catch(() => {});
    }
  }
}

export class BrowserUnavailableError extends Error {
  constructor() {
    super("No headless browser is available on this host");
    this.name = "BrowserUnavailableError";
  }
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
