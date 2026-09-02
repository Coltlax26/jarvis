import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { Action } from "../actions/types.js";
import type { RunRequest } from "./types.js";

// Scriptable fake for the Anthropic Messages API.
const createMock = vi.fn();
const ctorArgs: unknown[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create: createMock };
    constructor(opts: unknown) {
      ctorArgs.push(opts);
    }
  }
  return { default: FakeAnthropic };
});

const { DirectRunner } = await import("./directRunner.js");

const noteAction: Action<{ text: string }> = {
  name: "note",
  tier: 0,
  description: "save a note",
  schema: z.object({ text: z.string() }),
  summarize: (i) => i.text,
  run: async () => ({ ok: true, message: "saved" }),
};

function baseReq(over: Partial<RunRequest> = {}): RunRequest {
  return {
    systemPrompt: "you are jarvis",
    userPrompt: "hi",
    toolActions: [],
    onToolAttempt: async () => ({ allow: true }),
    ...over,
  };
}

const usage = { input_tokens: 10, output_tokens: 5 };

beforeEach(() => {
  createMock.mockReset();
});

describe("DirectRunner", () => {
  it("returns a plain text reply", async () => {
    createMock.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Hello Colt." }],
      usage,
    });
    const runner = new DirectRunner({ model: "claude-haiku-4-5", apiKey: "k" });
    const out = await runner.run(baseReq());
    expect(out.text).toBe("Hello Colt.");
    expect(out.costUsd).toBeGreaterThan(0);
    expect(createMock).toHaveBeenCalledOnce();
  });

  it("runs a tool call through onToolAttempt and feeds the result back", async () => {
    const seen: string[] = [];
    createMock
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu_1", name: "note", input: { text: "buy milk" } },
        ],
        usage,
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Noted." }],
        usage,
      });
    const runner = new DirectRunner({ model: "claude-haiku-4-5", apiKey: "k" });
    const out = await runner.run(
      baseReq({
        toolActions: [noteAction as Action],
        onToolAttempt: async (name, input) => {
          seen.push(`${name}:${JSON.stringify(input)}`);
          return { allow: true, result: "• Bob — Lunch?: wanna grab lunch" };
        },
      })
    );
    expect(seen).toEqual(['note:{"text":"buy milk"}']);
    expect(out.text).toBe("Noted.");
    expect(createMock).toHaveBeenCalledTimes(2);
    // second call must feed the action's own output back as the tool_result
    const secondCallMessages = createMock.mock.calls[1]![0].messages;
    const lastMsg = secondCallMessages[secondCallMessages.length - 1];
    expect(lastMsg.content[0].type).toBe("tool_result");
    expect(lastMsg.content[0].tool_use_id).toBe("tu_1");
    expect(lastMsg.content[0].content).toBe("• Bob — Lunch?: wanna grab lunch");
  });

  it("passes a denied tool's message back to the model as an error", async () => {
    createMock
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_9", name: "note", input: { text: "x" } }],
        usage,
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "It's queued for your approval." }],
        usage,
      });
    const runner = new DirectRunner({ model: "claude-haiku-4-5", apiKey: "k" });
    await runner.run(
      baseReq({
        toolActions: [noteAction as Action],
        onToolAttempt: async () => ({ allow: false, message: "waiting for approval" }),
      })
    );
    const secondCallMessages = createMock.mock.calls[1]![0].messages;
    const toolResult = secondCallMessages[secondCallMessages.length - 1].content[0];
    expect(toolResult.content).toBe("waiting for approval");
    expect(toolResult.is_error).toBe(true);
  });

  it("stops after the iteration cap even if the model keeps calling tools", async () => {
    createMock.mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_loop", name: "note", input: { text: "x" } }],
      usage,
    });
    const runner = new DirectRunner({ model: "claude-haiku-4-5", apiKey: "k" });
    await runner.run(baseReq({ toolActions: [noteAction as Action] }));
    expect(createMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("sets the workspace-id header when given", async () => {
    ctorArgs.length = 0;
    new DirectRunner({
      model: "claude-haiku-4-5",
      apiKey: "k",
      anthropicWorkspaceId: "wrkspc_1",
    });
    const opts = ctorArgs[0] as { defaultHeaders?: Record<string, string> };
    expect(opts.defaultHeaders?.["anthropic-workspace-id"]).toBe("wrkspc_1");

    ctorArgs.length = 0;
    new DirectRunner({ model: "claude-haiku-4-5", apiKey: "k" });
    expect((ctorArgs[0] as { defaultHeaders?: unknown }).defaultHeaders).toBeUndefined();
  });
});
