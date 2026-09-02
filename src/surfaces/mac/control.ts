import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../logger.js";

const run = promisify(execFile);

/**
 * Opens things on the Mac that Jarvis runs on. Uses `open` via `execFile`
 * (argv array, no shell) so there is no command-injection surface. Only two
 * verbs: open an https(s) URL in the default browser, and open/focus a named
 * app. No file paths, no AppleScript, no arbitrary args.
 */
export class MacControl {
  async openUrl(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("only http(s) URLs can be opened");
    }
    await run("open", [url]);
    logger.info("mac: opened url", { url });
  }

  async openApp(name: string): Promise<void> {
    if (!/^[A-Za-z0-9 .&'-]{1,50}$/.test(name)) {
      throw new Error("app name has unexpected characters");
    }
    await run("open", ["-a", name]);
    logger.info("mac: opened app", { app: name });
  }
}
