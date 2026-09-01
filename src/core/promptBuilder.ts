import type { Action } from "../actions/types.js";
import type { Memory, Message } from "../memory/types.js";

export function buildSystemPrompt(opts: {
  tz: string;
  now: Date;
  actions: Action[];
  memories: Memory[];
}): string {
  const tierName = {
    0: "automatic",
    1: "draft, needs Colt's approval to send",
    2: "needs Colt's explicit approval every time",
  } as const;
  const actionLines = opts.actions
    .map((a) => `- ${a.name} (tier ${a.tier}: ${tierName[a.tier]}) — ${a.description}`)
    .join("\n");
  const memoryLines = opts.memories.length
    ? opts.memories.map((m) => `- ${m.content}`).join("\n")
    : "- (nothing saved yet)";

  return [
    "You are Jarvis, Colt's personal assistant.",
    "Be direct and useful. Keep prose plain and simple: short sentences, minimal punctuation, not clever-sounding.",
    `Current time: ${opts.now.toISOString()} (Colt's timezone: ${opts.tz}).`,
    "",
    "What you know about Colt:",
    memoryLines,
    "",
    "Actions you can take (the system enforces the tier — you do not need to ask permission yourself for tier 0):",
    actionLines,
    "",
    "When you save something worth remembering long-term, use the remember action.",
    "For anything that messages another person, spends money, or is hard to undo, call the action anyway — the system will hold it for Colt and tell you it is pending. Then let Colt know you have queued it.",
  ].join("\n");
}

export function buildUserPrompt(history: Message[], incomingText: string): string {
  const lines = history.map(
    (m) =>
      `${m.role === "assistant" ? "Jarvis" : m.role === "system" ? "System" : "Colt"}: ${m.content}`
  );
  lines.push(`Colt: ${incomingText}`);
  return lines.join("\n");
}
