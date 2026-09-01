import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { AnyZodRawShape } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ModelRunner, RunRequest, RunResult } from "./types.js";
import { logger } from "../logger.js";

const SAFE_BUILTIN_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];

const DEFAULT_TIMEOUT_MS = 120_000;

export class SdkRunner implements ModelRunner {
  constructor(
    private opts: {
      model: string;
      apiKey: string;
      workspaceDir: string;
      timeoutMs?: number;
    }
  ) {}

  async run(req: RunRequest): Promise<RunResult> {
    process.env.ANTHROPIC_API_KEY = this.opts.apiKey;

    const jarvisTools = req.toolActions.map((action) => {
      const shape: AnyZodRawShape =
        (action.schema as unknown as { shape?: AnyZodRawShape }).shape ?? {
          input: z.any(),
        };
      return tool(
        action.name,
        action.description,
        shape,
        async (args: Record<string, unknown>) => {
          const decision = await req.onToolAttempt(action.name, args);
          if (!decision.allow) {
            return {
              content: [{ type: "text" as const, text: decision.message }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: `ok: ${action.name} accepted` }],
          };
        }
      );
    });

    const server = createSdkMcpServer({
      name: "jarvis",
      version: "1.0.0",
      tools: jarvisTools,
    });

    const stream = query({
      prompt: req.userPrompt,
      options: {
        model: this.opts.model,
        systemPrompt: req.systemPrompt,
        cwd: this.opts.workspaceDir,
        mcpServers: { jarvis: server },
        allowedTools: [
          ...SAFE_BUILTIN_TOOLS,
          ...req.toolActions.map((a) => `mcp__jarvis__${a.name}`),
        ],
        permissionMode: "default",
      },
    });

    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const consume = async (): Promise<RunResult> => {
      let finalText = "";
      let cost = 0;
      for await (const message of stream) {
        if (message.type === "result") {
          cost = message.total_cost_usd ?? 0;
          if (message.subtype === "success") {
            finalText = message.result;
          } else {
            throw new Error(`Model run failed (${message.subtype}): ${message.errors.join("; ")}`);
          }
        }
      }
      if (!finalText) logger.warn("SdkRunner produced no final text");
      return { text: finalText, costUsd: cost };
    };

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Model run timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([consume(), timeout]);
    } catch (err) {
      await stream.return(undefined).catch(() => {});
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
