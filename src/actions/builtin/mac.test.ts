import { describe, it, expect } from "vitest";
import { openUrlAction, openAppAction } from "./mac.js";

const ctx = { userId: "colt", originSurface: "web" };

function fakeApi() {
  const calls: string[] = [];
  return {
    calls,
    api: {
      openUrl: async (u: string) => {
        calls.push(`url:${u}`);
      },
      openApp: async (n: string) => {
        calls.push(`app:${n}`);
      },
    },
  };
}

describe("mac actions", () => {
  it("open_url is tier 0 and opens a valid https URL", async () => {
    const { api, calls } = fakeApi();
    const a = openUrlAction(api);
    expect(a.tier).toBe(0);
    const res = await a.run({ url: "https://calendar.google.com" }, ctx);
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["url:https://calendar.google.com"]);
  });

  it("open_url schema rejects non-http targets", () => {
    const a = openUrlAction(fakeApi().api);
    expect(a.schema.safeParse({ url: "file:///etc/passwd" }).success).toBe(false);
    expect(a.schema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(a.schema.safeParse({ url: "calendar.google.com" }).success).toBe(false);
    expect(a.schema.safeParse({ url: "https://x.com" }).success).toBe(true);
  });

  it("open_app is tier 0 and opens a named app", async () => {
    const { api, calls } = fakeApi();
    const a = openAppAction(api);
    expect(a.tier).toBe(0);
    await a.run({ name: "Notes" }, ctx);
    expect(calls).toEqual(["app:Notes"]);
  });

  it("open_app schema rejects shell-ish names", () => {
    const a = openAppAction(fakeApi().api);
    expect(a.schema.safeParse({ name: "Notes; rm -rf ~" }).success).toBe(false);
    expect(a.schema.safeParse({ name: "$(whoami)" }).success).toBe(false);
    expect(a.schema.safeParse({ name: "Google Chrome" }).success).toBe(true);
  });

  it("reports a failure without throwing", async () => {
    const a = openUrlAction({
      openUrl: async () => {
        throw new Error("no browser");
      },
      openApp: async () => {},
    });
    const res = await a.run({ url: "https://x.com" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no browser/);
  });
});
