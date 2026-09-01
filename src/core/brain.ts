import type { Config } from "../config.js";
import type { ActionGate } from "../actions/gate.js";
import type { ActionRegistry } from "../actions/registry.js";
import type { MemoryRepo } from "../memory/repo.js";
import { buildSystemPrompt, buildUserPrompt } from "./promptBuilder.js";
import type { IncomingMessage, ModelRunner, OutgoingMessage, ToolDecision } from "./types.js";

export class Brain {
  private memory: MemoryRepo;
  private gate: ActionGate;
  private registry: ActionRegistry;
  private runner: ModelRunner;
  private config: Pick<Config, "tz" | "workspaceDir">;

  constructor(deps: {
    memory: MemoryRepo;
    gate: ActionGate;
    registry: ActionRegistry;
    runner: ModelRunner;
    config: Pick<Config, "tz" | "workspaceDir">;
  }) {
    this.memory = deps.memory;
    this.gate = deps.gate;
    this.registry = deps.registry;
    this.runner = deps.runner;
    this.config = deps.config;
  }

  async handle(msg: IncomingMessage): Promise<OutgoingMessage> {
    const conversationId = await this.memory.getOrCreateConversation(msg.userId);
    const history = await this.memory.recentMessages(conversationId, 30);
    const memories = await this.memory.searchMemories(msg.userId, msg.text, 12);

    const actions = this.registry.list();
    const systemPrompt = buildSystemPrompt({
      tz: this.config.tz,
      now: new Date(),
      actions,
      memories,
    });
    const userPrompt = buildUserPrompt(history, msg.text);

    await this.memory.addMessage({
      conversationId,
      role: "user",
      surface: msg.surface,
      content: msg.text,
    });

    const result = await this.runner.run({
      systemPrompt,
      userPrompt,
      toolActions: actions,
      onToolAttempt: async (name, input): Promise<ToolDecision> => {
        const outcome = await this.gate.attempt(name, input, {
          userId: msg.userId,
          originSurface: msg.surface,
        });
        if (outcome.kind === "executed") {
          return outcome.result.ok
            ? { allow: true }
            : { allow: false, message: `Action failed: ${outcome.result.message}` };
        }
        if (outcome.kind === "held") {
          const kind = outcome.tier === 1 ? "drafted and is waiting" : "is waiting";
          return {
            allow: false,
            message: `This ${kind} for Colt's approval (pending id ${outcome.pendingId}). Tell Colt it is queued; do not assume it happened.`,
          };
        }
        return { allow: false, message: `Rejected: ${outcome.reason}` };
      },
    });

    const replyText = result.text || "(no reply)";
    await this.memory.addMessage({
      conversationId,
      role: "assistant",
      surface: msg.surface,
      content: replyText,
    });

    return { userId: msg.userId, surface: msg.surface, text: replyText };
  }
}
