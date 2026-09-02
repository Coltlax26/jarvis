import type { Config } from "../config.js";
import type { ActionGate } from "../actions/gate.js";
import type { ActionRegistry } from "../actions/registry.js";
import type { MemoryRepo } from "../memory/repo.js";
import type { ActivityRepo } from "../activity/repo.js";
import type { SettingsRepo } from "../settings/repo.js";
import type { JarvisBus, JarvisEvent, JarvisEventKind } from "./events.js";
import { buildSystemPrompt, buildUserPrompt } from "./promptBuilder.js";
import type { IncomingMessage, ModelRunner, OutgoingMessage, ToolDecision } from "./types.js";

export class Brain {
  private memory: MemoryRepo;
  private gate: ActionGate;
  private registry: ActionRegistry;
  private runner: ModelRunner;
  private config: Pick<Config, "tz" | "workspaceDir">;
  private bus?: JarvisBus;
  private activity?: ActivityRepo;
  private settings?: SettingsRepo;

  constructor(deps: {
    memory: MemoryRepo;
    gate: ActionGate;
    registry: ActionRegistry;
    runner: ModelRunner;
    config: Pick<Config, "tz" | "workspaceDir">;
    bus?: JarvisBus;
    activity?: ActivityRepo;
    settings?: SettingsRepo;
  }) {
    this.memory = deps.memory;
    this.gate = deps.gate;
    this.registry = deps.registry;
    this.runner = deps.runner;
    this.config = deps.config;
    this.bus = deps.bus;
    this.activity = deps.activity;
    this.settings = deps.settings;
  }

  private emit(
    userId: string,
    surface: string,
    kind: JarvisEventKind,
    text: string,
    data?: unknown
  ): void {
    const event: JarvisEvent = { kind, text, at: new Date().toISOString(), surface, data };
    this.bus?.publish(userId, event);
  }

  private async logActivity(
    entry: Parameters<NonNullable<Brain["activity"]>["log"]>[0]
  ): Promise<void> {
    if (!this.activity) return;
    try {
      await this.activity.log(entry);
    } catch {
      /* activity logging is best-effort; never break a turn over it */
    }
  }

  async handle(msg: IncomingMessage): Promise<OutgoingMessage> {
    const conversationId = await this.memory.getOrCreateConversation(msg.userId);
    const user = await this.memory.getUser(msg.userId);
    const userName = user?.name ?? "there";
    const persona = user?.persona ?? "";
    const history = await this.memory.recentMessages(conversationId, 30);
    const memories = await this.memory.searchMemories(msg.userId, msg.text, 12);
    // Live, user-editable extra guidance from the console Brain tab.
    const instructions = this.settings
      ? await this.settings.get(msg.userId, "instructions", "")
      : "";

    const runner = this.runner;

    const actions = this.registry.list();
    const systemPrompt = buildSystemPrompt({
      userName,
      persona,
      instructions,
      tz: this.config.tz,
      now: new Date(),
      actions,
      memories,
    });
    const userPrompt = buildUserPrompt(history, msg.text, userName);

    await this.memory.addMessage({
      conversationId,
      role: "user",
      surface: msg.surface,
      content: msg.text,
    });
    this.emit(msg.userId, msg.surface, "turn_start", trim(msg.text));
    await this.logActivity({
      userId: msg.userId,
      kind: "message_in",
      summary: `${msg.surface}: ${trim(msg.text)}`,
    });
    this.emit(msg.userId, msg.surface, "thinking", "Thinking…");

    let result;
    try {
      result = await runner.run({
        systemPrompt,
        userPrompt,
        toolActions: actions,
        onToolAttempt: async (name, input): Promise<ToolDecision> => {
          const outcome = await this.gate.attempt(name, input, {
            userId: msg.userId,
            originSurface: msg.surface,
          });
          if (outcome.kind === "executed") {
            if (outcome.result.ok) {
              this.emit(msg.userId, msg.surface, "tool_run", `Did: ${name}`, { name });
              await this.logActivity({
                userId: msg.userId,
                kind: "action_run",
                summary: `Ran ${name}`,
                detail: { name, input },
              });
              // Hand the action's own output back to the model — for read
              // actions (inbox, calendar) this text *is* the answer.
              return { allow: true, result: outcome.result.message };
            }
            this.emit(msg.userId, msg.surface, "error", `${name} failed`, { name });
            return { allow: false, message: `Action failed: ${outcome.result.message}` };
          }
          if (outcome.kind === "held") {
            const verb = outcome.tier === 1 ? "drafted and is waiting" : "is waiting";
            this.emit(msg.userId, msg.surface, "tool_held", `Queued for your approval: ${name}`, {
              name,
              tier: outcome.tier,
              pendingId: outcome.pendingId,
            });
            await this.logActivity({
              userId: msg.userId,
              kind: "action_held",
              summary: `Queued ${name} (tier ${outcome.tier}) for approval`,
              detail: { name, tier: outcome.tier, pendingId: outcome.pendingId, input },
            });
            return {
              allow: false,
              message: `This ${verb} for Colt's approval (pending id ${outcome.pendingId}). Tell Colt it is queued; do not assume it happened.`,
            };
          }
          this.emit(msg.userId, msg.surface, "tool_rejected", `Rejected: ${name}`, { name });
          return { allow: false, message: `Rejected: ${outcome.reason}` };
        },
      });
    } catch (err) {
      this.emit(msg.userId, msg.surface, "error", (err as Error).message);
      await this.logActivity({
        userId: msg.userId,
        kind: "error",
        summary: (err as Error).message,
      });
      throw err;
    }

    const replyText = result.text || "(no reply)";
    await this.memory.addMessage({
      conversationId,
      role: "assistant",
      surface: msg.surface,
      content: replyText,
    });
    this.emit(msg.userId, msg.surface, "turn_end", trim(replyText), {
      costUsd: result.costUsd,
    });
    await this.logActivity({
      userId: msg.userId,
      kind: "reply",
      summary: trim(replyText),
      detail: { costUsd: result.costUsd, surface: msg.surface },
    });

    return { userId: msg.userId, surface: msg.surface, text: replyText };
  }
}

function trim(s: string, n = 140): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
}
