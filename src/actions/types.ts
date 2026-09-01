import type { ZodType } from "zod";

export type Tier = 0 | 1 | 2;

export type ActionContext = { userId: string; originSurface: string };
export type ActionResult = { ok: boolean; message: string; data?: unknown };

export interface Action<I = Record<string, unknown>> {
  name: string;
  tier: Tier;
  description: string;
  schema: ZodType<I>;
  summarize(input: I): string;
  run(input: I, ctx: ActionContext): Promise<ActionResult>;
}

export type PendingStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "done"
  | "failed";

export type PendingAction = {
  id: string;
  userId: string;
  actionName: string;
  input: Record<string, unknown>;
  tier: Exclude<Tier, 0>;
  status: PendingStatus;
  originSurface: string;
  summary: string;
  result: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
};
