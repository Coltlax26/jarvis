import { describe, it, expect } from "vitest";
import { SurfaceRegistry } from "./registry.js";
import type { Surface } from "./types.js";

function fakeSurface(name: string, sink: string[]): Surface {
  return {
    name,
    start: async () => {},
    stop: async () => {},
    send: async (userId, text) => {
      sink.push(`${name}->${userId}:${text}`);
    },
  };
}

describe("SurfaceRegistry", () => {
  it("delivers to the named surface", async () => {
    const sink: string[] = [];
    const reg = new SurfaceRegistry();
    reg.add(fakeSurface("web", sink));
    reg.add(fakeSurface("telegram", sink));
    await reg.deliver({ userId: "colt", surface: "telegram", text: "hi" });
    expect(sink).toEqual(["telegram->colt:hi"]);
  });

  it("broadcasts when the surface is unknown", async () => {
    const sink: string[] = [];
    const reg = new SurfaceRegistry();
    reg.add(fakeSurface("web", sink));
    reg.add(fakeSurface("telegram", sink));
    await reg.deliver({ userId: "colt", surface: "scheduler", text: "reminder" });
    expect(sink.sort()).toEqual(["telegram->colt:reminder", "web->colt:reminder"]);
  });
});
