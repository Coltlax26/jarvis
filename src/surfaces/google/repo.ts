import type { Db } from "../../db/index.js";

export type GoogleTokens = {
  accessToken: string | null;
  refreshToken: string;
  scope: string | null;
  tokenType: string | null;
  expiryDate: number | null;
};

/** Per-user Google OAuth token store. */
export class GoogleTokenRepo {
  constructor(private db: Db) {}

  async get(userId: string): Promise<GoogleTokens | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from google_tokens where user_id = $1`,
      [userId]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      accessToken: (r.access_token as string | null) ?? null,
      refreshToken: r.refresh_token as string,
      scope: (r.scope as string | null) ?? null,
      tokenType: (r.token_type as string | null) ?? null,
      expiryDate:
        r.expiry_date == null ? null : Number(r.expiry_date as string | number),
    };
  }

  /** Upsert. A missing refresh_token keeps the stored one (Google only sends it once). */
  async save(userId: string, t: Partial<GoogleTokens> & { refreshToken?: string }): Promise<void> {
    const existing = await this.get(userId);
    const refreshToken = t.refreshToken || existing?.refreshToken;
    if (!refreshToken) throw new Error("no refresh token to store for Google");
    await this.db.query(
      `insert into google_tokens
         (user_id, access_token, refresh_token, scope, token_type, expiry_date, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (user_id) do update set
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         scope = coalesce(excluded.scope, google_tokens.scope),
         token_type = coalesce(excluded.token_type, google_tokens.token_type),
         expiry_date = excluded.expiry_date,
         updated_at = now()`,
      [
        userId,
        t.accessToken ?? existing?.accessToken ?? null,
        refreshToken,
        t.scope ?? existing?.scope ?? null,
        t.tokenType ?? existing?.tokenType ?? null,
        t.expiryDate ?? null,
      ]
    );
  }

  async delete(userId: string): Promise<void> {
    await this.db.query(`delete from google_tokens where user_id = $1`, [userId]);
  }

  async connectedUserIds(): Promise<string[]> {
    const { rows } = await this.db.query<{ user_id: string }>(
      `select user_id from google_tokens`
    );
    return rows.map((r) => r.user_id);
  }
}
