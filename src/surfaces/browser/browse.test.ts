import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../../test/helpers/db.js";
import type { Db } from "../../db/index.js";
import { MemoryRepo } from "../../memory/repo.js";
import { ActionRegistry } from "../../actions/registry.js";
import { ActionGate } from "../../actions/gate.js";
import { registerBuiltins } from "../../actions/builtin/index.js";
import { JarvisBus, type JarvisEvent } from "../../core/events.js";
import { BrowseService, type BrowserLike } from "./service.js";
import { BrowserRunner } from "./runner.js";

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
});
afterEach(async () => {
  await db.close();
});

const ctx = { userId: "colt", originSurface: "web" };

const okRunner: BrowserLike = {
  available: () => true,
  browse: async (url) => ({
    url,
    finalUrl: url,
    title: "Example Domain",
    text: "This domain is for use in illustrative examples.",
    screenshot: Buffer.from("PNGDATA"),
  }),
};

describe("browse action + service", () => {
  it("is registered as tier 2", async () => {
    const reg = new ActionRegistry();
    registerBuiltins(reg, {
      memory: new MemoryRepo(db),
      db,
      browse: { run: (u, i) => new BrowseService({ runner: okRunner, publicUrl: "http://x" }).run(u, i) },
    });
    const gate = new ActionGate(db, reg);
    const held = await gate.attempt("browse", { url: "example.com" }, ctx);
    expect(held.kind).toBe("held");
    if (held.kind === "held") expect(held.tier).toBe(2);
  });

  it("returns page text + a screenshot URL and emits a console event", async () => {
    const bus = new JarvisBus();
    const events: JarvisEvent[] = [];
    bus.subscribe("colt", (e) => events.push(e));
    const svc = new BrowseService({ runner: okRunner, publicUrl: "http://x", bus });
    const out = await svc.run("colt", { url: "example.com" });
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/Example Domain/);
    const url = out.data?.screenshotUrl ?? "";
    expect(url).toMatch(/\/browse\/shot\/[a-f0-9-]+\.png$/);
    const id = url.split("/").pop()!.replace(".png", "");
    expect(svc.shotFor(id)?.toString()).toBe("PNGDATA");
    expect(events.some((e) => e.kind === "tool_run" && /Browsed/.test(e.text))).toBe(true);
  });

  it("degrades cleanly when no browser is available", async () => {
    const svc = new BrowseService({
      runner: { available: () => false, browse: async () => { throw new Error("nope"); } },
      publicUrl: "http://x",
    });
    const out = await svc.run("colt", { url: "example.com" });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/isn't available/i);
  });

  it("reports a load failure without throwing", async () => {
    const svc = new BrowseService({
      runner: {
        available: () => true,
        browse: async () => {
          throw new Error("net::ERR_NAME_NOT_RESOLVED");
        },
      },
      publicUrl: "http://x",
    });
    const out = await svc.run("colt", { url: "no-such-host.invalid" });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/Couldn't load/);
  });

  it("BrowserRunner reports unavailable when the executable path does not exist", () => {
    const r = new BrowserRunner({ executablePath: "/definitely/not/here" });
    expect(r.available()).toBe(false);
  });
});
