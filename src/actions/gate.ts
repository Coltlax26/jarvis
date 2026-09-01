import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import type { ActionRegistry } from "./registry.js";
import type {
  ActionContext,
  ActionResult,
  PendingAction,
  Tier,
} from "./types.js";

export type GateOutcome =
  | { kind: "executed"; result: ActionResult }
  | { kind: "held"; pendingId: string; tier: Exclude<Tier, 0>; summary: string }
  | { kind: "rejected"; reason: string };

export class ActionGate {
  constructor(
    private db: Db,
    private registry: ActionRegistry
  ) {}

  async attempt(
    name: string,
    rawInput: unknown,
    ctx: ActionContext
  ): Promise<GateOutcome> {
    const action = this.registry.get(name);
    if (!action) return { kind: "rejected", reason: `Unknown action: ${name}` };

    const parsed = action.schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        kind: "rejected",
        reason: `Invalid input for ${name}: ${parsed.error.message}`,
      };
    }
    const input = parsed.data;

    if (action.tier === 0) {
      const result = await action.run(input, ctx);
      return { kind: "executed", result };
    }

    const id = randomUUID();
    const status = action.tier === 1 ? "draft" : "awaiting_approval";
    const summary = safeSummary(action, input);
    await this.db.query(
      `insert into pending_actions
        (id, user_id, action_name, input, tier, status, origin_surface, summary)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        ctx.userId,
        name,
        JSON.stringify(input),
        action.tier,
        status,
        ctx.originSurface,
        summary,
      ]
    );
    return { kind: "held", pendingId: id, tier: action.tier, summary };
  }

  async listPending(userId: string): Promise<PendingAction[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from pending_actions
       where user_id = $1 and status in ('draft','awaiting_approval')
       order by created_at asc`,
      [userId]
    );
    return rows.map(rowToPending);
  }

  async approve(pendingId: string, userId: string): Promise<ActionResult> {
    const row = await this.load(pendingId);
    if (!row) throw new Error(`No pending action ${pendingId}`);
    if (row.userId !== userId) {
      throw new Error(`Pending action ${pendingId} is not yours`);
    }
    if (row.status !== "draft" && row.status !== "awaiting_approval") {
      throw new Error(
        `Pending action ${pendingId} is ${row.status}, cannot approve`
      );
    }
    const action = this.registry.get(row.actionName);
    if (!action) throw new Error(`Action ${row.actionName} no longer exists`);

    const parsed = action.schema.safeParse(row.input);
    if (!parsed.success) {
      await this.finish(pendingId, "failed", { error: parsed.error.message });
      throw new Error(`Stored input for ${row.actionName} is no longer valid`);
    }

    try {
      const result = await action.run(parsed.data, {
        userId: row.userId,
        originSurface: row.originSurface,
      });
      await this.finish(pendingId, result.ok ? "done" : "failed", result);
      return result;
    } catch (err) {
      const result: ActionResult = {
        ok: false,
        message: (err as Error).message,
      };
      await this.finish(pendingId, "failed", result);
      return result;
    }
  }

  async reject(pendingId: string, userId: string): Promise<void> {
    const row = await this.load(pendingId);
    if (!row) throw new Error(`No pending action ${pendingId}`);
    if (row.userId !== userId) {
      throw new Error(`Pending action ${pendingId} is not yours`);
    }
    await this.finish(pendingId, "rejected", null);
  }

  private async load(id: string): Promise<PendingAction | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from pending_actions where id = $1`,
      [id]
    );
    return rows[0] ? rowToPending(rows[0]) : null;
  }

  private async finish(
    id: string,
    status: string,
    result: unknown
  ): Promise<void> {
    await this.db.query(
      `update pending_actions set status = $2, result = $3, resolved_at = now() where id = $1`,
      [id, status, result === null ? null : JSON.stringify(result)]
    );
  }
}

function safeSummary(
  action: { summarize: (i: never) => string },
  input: unknown
): string {
  try {
    return action.summarize(input as never);
  } catch {
    return "";
  }
}

function rowToPending(r: Record<string, unknown>): PendingAction {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    actionName: r.action_name as string,
    input:
      typeof r.input === "string"
        ? JSON.parse(r.input)
        : (r.input as Record<string, unknown>),
    tier: Number(r.tier) as 1 | 2,
    status: r.status as PendingAction["status"],
    originSurface: r.origin_surface as string,
    summary: (r.summary as string) ?? "",
    result:
      typeof r.result === "string" ? JSON.parse(r.result) : (r.result ?? null),
    createdAt: new Date(r.created_at as string),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at as string) : null,
  };
}
