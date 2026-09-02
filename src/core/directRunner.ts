import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ModelRunner, RunRequest, RunResult } from "./types.js";
import { logger } from "../logger.js";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_ITERATIONS = 4;

/**
 * A subprocess-free ModelRunner: one direct Messages API call plus a small
 * tool-use loop. Much lower latency than SdkRunner (no agent subprocess), which
 * matters on phone calls. No built-in tools — only the Jarvis actions passed in.
 */
export class DirectRunner implements ModelRunner {
  private client: Anthropic;

  constructor(
    private opts: {
      model: string;
      apiKey: string;
      anthropicWorkspaceId?: string | null;
      maxTokens?: number;
      timeoutMs?: number;
    }
  ) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.anthropicWorkspaceId
        ? { defaultHeaders: { "anthropic-workspace-id": opts.anthropicWorkspaceId } }
        : {}),
    });
  }

  async run(req: RunRequest): Promise<RunResult> {
    const tools: Anthropic.Tool[] = req.toolActions.map((action) => {
      let schema: Record<string, unknown>;
      try {
        schema = z.toJSONSchema(action.schema as z.ZodType, {
          target: "draft-7",
        }) as Record<string, unknown>;
      } catch {
        schema = { type: "object", properties: {}, additionalProperties: true };
      }
      // Anthropic requires an object schema at the top level.
      if (schema.type !== "object") {
        schema = { type: "object", properties: {}, additionalProperties: true };
      }
      return {
        name: action.name,
        description: action.description,
        input_schema: schema as Anthropic.Tool.InputSchema,
      };
    });

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: req.userPrompt },
    ];

    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let costUsd = 0;
    let finalText = "";

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Model run timed out after ${timeoutMs}ms`);

      const response = await this.client.messages.create(
        {
          model: this.opts.model,
          max_tokens: this.opts.maxTokens ?? 600,
          system: req.systemPrompt,
          messages,
          ...(tools.length ? { tools } : {}),
        },
        { timeout: remaining }
      );

      costUsd += estimateCost(this.opts.model, response.usage);

      const textParts = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text);
      if (textParts.length) finalText = textParts.join(" ").trim();

      if (response.stop_reason !== "tool_use") break;

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const decision = await req.onToolAttempt(tu.name, tu.input);
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: decision.allow
            ? (decision.result ?? `ok: ${tu.name} accepted`)
            : decision.message,
          ...(decision.allow ? {} : { is_error: true }),
        });
      }
      messages.push({ role: "user", content: results });
    }

    if (!finalText) logger.warn("DirectRunner produced no final text");
    return { text: finalText, costUsd };
  }
}

// Rough $/token so the console cost figure is non-zero; not a billing source.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1 / 1e6, out: 5 / 1e6 },
  "claude-sonnet-5": { in: 2 / 1e6, out: 10 / 1e6 },
  "claude-opus-5": { in: 5 / 1e6, out: 25 / 1e6 },
};
function estimateCost(model: string, usage: Anthropic.Usage): number {
  const p = PRICES[model] ?? PRICES["claude-haiku-4-5"]!;
  return (usage.input_tokens ?? 0) * p.in + (usage.output_tokens ?? 0) * p.out;
}
