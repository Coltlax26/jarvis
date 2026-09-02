import { randomUUID } from "node:crypto";
import type { Db } from "../../db/index.js";

export type CallLine = { speaker: "jarvis" | "them"; text: string };

export type OutboundCall = {
  id: string;
  callSid: string | null;
  ownerId: string;
  counterparty: string;
  purpose: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  transcript: CallLine[];
  createdAt: Date;
};

/** Store for outbound calls Jarvis places on a user's behalf. */
export class OutboundCallRepo {
  constructor(private db: Db) {}

  async create(input: {
    ownerId: string;
    counterparty: string;
    purpose: string;
  }): Promise<OutboundCall> {
    const id = randomUUID();
    await this.db.query(
      `insert into voice_calls (id, owner_id, counterparty, purpose, status)
       values ($1,$2,$3,$4,'queued')`,
      [id, input.ownerId, input.counterparty, input.purpose]
    );
    return {
      id,
      callSid: null,
      ownerId: input.ownerId,
      counterparty: input.counterparty,
      purpose: input.purpose,
      status: "queued",
      transcript: [],
      createdAt: new Date(),
    };
  }

  async get(id: string): Promise<OutboundCall | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from voice_calls where id = $1`,
      [id]
    );
    return rows[0] ? rowToCall(rows[0]) : null;
  }

  async attachSid(id: string, callSid: string): Promise<void> {
    await this.db.query(
      `update voice_calls set call_sid = $2, status = 'in_progress', updated_at = now()
       where id = $1`,
      [id, callSid]
    );
  }

  async appendLine(id: string, line: CallLine): Promise<void> {
    await this.db.query(
      `update voice_calls
       set transcript = transcript || $2::jsonb, updated_at = now()
       where id = $1`,
      [id, JSON.stringify([line])]
    );
  }

  async setStatus(id: string, status: OutboundCall["status"]): Promise<void> {
    await this.db.query(
      `update voice_calls set status = $2, updated_at = now() where id = $1`,
      [id, status]
    );
  }

  async recentForOwner(ownerId: string, limit = 20): Promise<OutboundCall[]> {
    const n = Math.max(1, Math.min(100, Math.floor(limit)));
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from voice_calls where owner_id = $1 order by created_at desc limit ${n}`,
      [ownerId]
    );
    return rows.map(rowToCall);
  }
}

function rowToCall(r: Record<string, unknown>): OutboundCall {
  const raw = r.transcript;
  const transcript: CallLine[] = Array.isArray(raw)
    ? (raw as CallLine[])
    : typeof raw === "string"
      ? (JSON.parse(raw) as CallLine[])
      : [];
  return {
    id: r.id as string,
    callSid: (r.call_sid as string | null) ?? null,
    ownerId: r.owner_id as string,
    counterparty: r.counterparty as string,
    purpose: r.purpose as string,
    status: r.status as OutboundCall["status"],
    transcript,
    createdAt: new Date(r.created_at as string),
  };
}
