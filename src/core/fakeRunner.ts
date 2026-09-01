import type { ModelRunner, RunRequest, RunResult } from "./types.js";

export type FakeStep = { callTool?: { name: string; input: unknown }; say: string };

export class FakeRunner implements ModelRunner {
  lastUserPrompt = "";
  lastSystemPrompt = "";
  onDeny?: (message: string) => void;

  constructor(private steps: FakeStep[]) {}

  async run(req: RunRequest): Promise<RunResult> {
    this.lastUserPrompt = req.userPrompt;
    this.lastSystemPrompt = req.systemPrompt;
    const parts: string[] = [];
    for (const step of this.steps) {
      if (step.callTool) {
        const decision = await req.onToolAttempt(step.callTool.name, step.callTool.input);
        if (!decision.allow) this.onDeny?.(decision.message);
      }
      if (step.say) parts.push(step.say);
    }
    return { text: parts.join(" ").trim(), costUsd: 0 };
  }
}
