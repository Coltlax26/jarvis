export type ParsedCommand =
  | { kind: "approve"; id: string }
  | { kind: "reject"; id: string }
  | { kind: "list" }
  | { kind: "chat"; text: string };

export function parseCommand(raw: string): ParsedCommand {
  const text = raw.trim();
  const m = /^(approve|reject)\s+(\S+)$/i.exec(text);
  if (m) return { kind: m[1]!.toLowerCase() as "approve" | "reject", id: m[2]! };
  if (/^(list\s+pending|pending)$/i.test(text)) return { kind: "list" };
  return { kind: "chat", text };
}
