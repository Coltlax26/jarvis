import type { Action } from "../actions/types.js";
import type { Memory, Message } from "../memory/types.js";

export function buildSystemPrompt(opts: {
  userName: string;
  persona?: string;
  /** Live extra guidance the user edits in the console Brain tab. */
  instructions?: string;
  tz: string;
  now: Date;
  actions: Action[];
  memories: Memory[];
}): string {
  const who = opts.userName;
  const tierName = {
    0: "automatic",
    1: `draft, needs ${who}'s approval to send`,
    2: `needs ${who}'s explicit approval every time`,
  } as const;
  const actionLines = opts.actions
    .map((a) => `- ${a.name} (tier ${a.tier}: ${tierName[a.tier]}) — ${a.description}`)
    .join("\n");
  const memoryLines = opts.memories.length
    ? opts.memories.map((m) => `- ${m.content}`).join("\n")
    : "- (nothing saved yet)";

  const personaLine = opts.persona?.trim()
    ? `\nYour role for ${who}: ${opts.persona.trim()}\n`
    : "";
  const instructionsLine = opts.instructions?.trim()
    ? `\n${who}'s standing instructions to you (edited live in the console):\n${opts.instructions.trim()}\n`
    : "";

  return [
    `You are Jarvis, ${who}'s personal assistant. You are talking with ${who}.`,
    "Be direct and useful. Keep prose plain and simple: short sentences, minimal punctuation, not clever-sounding.",
    personaLine,
    instructionsLine,
    `Current time: ${opts.now.toISOString()} (timezone: ${opts.tz}).`,
    "",
    `What you know about ${who}:`,
    memoryLines,
    "",
    "Actions you can take (the system enforces the tier — you do not need to ask permission yourself for tier 0):",
    actionLines,
    "",
    "When you save something worth remembering long-term, use the remember action.",
    `For anything that messages another person, spends money, or is hard to undo, call the action anyway — the system will hold it for ${who} and tell you it is pending. Then let ${who} know you have queued it.`,
  ].join("\n");
}

export function buildUserPrompt(
  history: Message[],
  incomingText: string,
  userName: string
): string {
  const lines = history.map(
    (m) =>
      `${m.role === "assistant" ? "Jarvis" : m.role === "system" ? "System" : userName}: ${m.content}`
  );
  lines.push(`${userName}: ${incomingText}`);
  return lines.join("\n");
}
