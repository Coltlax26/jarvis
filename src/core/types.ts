import type { Action } from "../actions/types.js";

export type IncomingMessage = { userId: string; surface: string; text: string };
export type OutgoingMessage = { userId: string; surface: string; text: string };

export type ToolDecision =
  /** `result` is the action's output, fed back to the model as the tool result. */
  | { allow: true; result?: string }
  | { allow: false; message: string };

export type RunRequest = {
  systemPrompt: string;
  userPrompt: string;
  toolActions: Action[];
  onToolAttempt: (name: string, input: unknown) => Promise<ToolDecision>;
};

export type RunResult = { text: string; costUsd: number };

export interface ModelRunner {
  run(req: RunRequest): Promise<RunResult>;
}
