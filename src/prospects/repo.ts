import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";

export const PROSPECT_STATUSES = [
  "new",
  "contacted",
  "interested",
  "quoted",
  "won",
  "lost",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export type Prospect = {
  id: string;
  name: string;
  businessType: string | null;
  town: string | null;
  phone: string | null;
  website: string | null;
  status: ProspectStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class ProspectRepo {
  constructor(private db: Db) {}

  async add(
    userId: string,
    p: {
      name: string;
      businessType?: string | null;
      town?: string | null;
      phone?: string | null;
      website?: string | null;
      notes?: string | null;
      status?: ProspectStatus;
    }
  ): Promise<Prospect> {
    // Dedupe on name+town for the same user — a re-run of lead-gen shouldn't pile up.
    const existing = await this.db.query<{ id: string }>(
      `select id from prospects
       where user_id = $1 and lower(name) = lower($2)
         and coalesce(lower(town),'') = coalesce(lower($3),'')`,
      [userId, p.name, p.town ?? null]
    );
    if (existing.rows[0]) {
      return (await this.get(userId, existing.rows[0].id))!;
    }
    const id = randomUUID();
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into prospects
        (id, user_id, name, business_type, town, phone, website, status, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [
        id,
        userId,
        p.name.slice(0, 200),
        p.businessType ?? null,
        p.town ?? null,
        p.phone ?? null,
        p.website ?? null,
        p.status ?? "new",
        p.notes ?? null,
      ]
    );
    return rowTo(rows[0]!);
  }

  async list(userId: string, status?: ProspectStatus): Promise<Prospect[]> {
    const { rows } = status
      ? await this.db.query<Record<string, unknown>>(
          `select * from prospects where user_id = $1 and status = $2 order by updated_at desc`,
          [userId, status]
        )
      : await this.db.query<Record<string, unknown>>(
          `select * from prospects where user_id = $1 order by updated_at desc limit 500`,
          [userId]
        );
    return rows.map(rowTo);
  }

  async get(userId: string, id: string): Promise<Prospect | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from prospects where user_id = $1 and id = $2`,
      [userId, id]
    );
    return rows[0] ? rowTo(rows[0]) : null;
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<
      Pick<Prospect, "name" | "businessType" | "town" | "phone" | "website" | "status" | "notes">
    >
  ): Promise<Prospect | null> {
    const cols: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, string> = {
      name: "name",
      businessType: "business_type",
      town: "town",
      phone: "phone",
      website: "website",
      status: "status",
      notes: "notes",
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        cols.push(`${col} = $${cols.length + 3}`);
        vals.push((patch as Record<string, unknown>)[k] ?? null);
      }
    }
    if (!cols.length) return this.get(userId, id);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `update prospects set ${cols.join(", ")}, updated_at = now()
       where user_id = $1 and id = $2 returning *`,
      [userId, id, ...vals]
    );
    return rows[0] ? rowTo(rows[0]) : null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `delete from prospects where user_id = $1 and id = $2 returning id`,
      [userId, id]
    );
    return rows.length > 0;
  }

  async counts(userId: string): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ status: string; n: string }>(
      `select status, count(*)::int as n from prospects where user_id = $1 group by status`,
      [userId]
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }
}

function rowTo(r: Record<string, unknown>): Prospect {
  return {
    id: r.id as string,
    name: r.name as string,
    businessType: (r.business_type as string | null) ?? null,
    town: (r.town as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    website: (r.website as string | null) ?? null,
    status: r.status as ProspectStatus,
    notes: (r.notes as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}
