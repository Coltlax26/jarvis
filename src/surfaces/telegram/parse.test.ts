import { describe, it, expect } from "vitest";
import { parseCommand } from "./parse.js";

describe("parseCommand", () => {
  it("parses approve/reject with an id", () => {
    expect(parseCommand("approve 3f2a")).toEqual({ kind: "approve", id: "3f2a" });
    expect(parseCommand("  reject   9  ")).toEqual({ kind: "reject", id: "9" });
  });
  it("parses list pending", () => {
    expect(parseCommand("list pending")).toEqual({ kind: "list" });
    expect(parseCommand("pending")).toEqual({ kind: "list" });
  });
  it("treats everything else as chat", () => {
    expect(parseCommand("what's on my calendar?")).toEqual({
      kind: "chat",
      text: "what's on my calendar?",
    });
    expect(parseCommand("approve")).toEqual({ kind: "chat", text: "approve" });
  });
});
