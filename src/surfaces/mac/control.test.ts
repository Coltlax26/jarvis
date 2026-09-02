import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[][] = [];
const execFileMock = vi.fn((...args: unknown[]) => {
  const cb = args[args.length - 1] as (e: Error | null, o: unknown) => void;
  calls.push(args.slice(0, -1).flat() as string[]);
  cb(null, { stdout: "", stderr: "" });
});
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { MacControl } = await import("./control.js");

beforeEach(() => {
  execFileMock.mockClear();
  calls.length = 0;
});

describe("MacControl", () => {
  it("opens an https URL via `open`", async () => {
    await new MacControl().openUrl("https://calendar.google.com");
    expect(calls[0]).toEqual(["open", "https://calendar.google.com"]);
  });

  it("rejects a non-http URL before shelling out", async () => {
    await expect(new MacControl().openUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("opens an app via `open -a`", async () => {
    await new MacControl().openApp("Notes");
    expect(calls[0]).toEqual(["open", "-a", "Notes"]);
  });

  it("rejects an app name with shell metacharacters", async () => {
    await expect(new MacControl().openApp("x; rm -rf ~")).rejects.toThrow();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
