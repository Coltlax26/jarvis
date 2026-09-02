import type { Db } from "../db/index.js";

/**
 * Per-user settings. `get` returns the stored value or the provided fallback
 * (typically an env-var default). Values are plain strings.
 */
export class SettingsRepo {
  constructor(private db: Db) {}

  async all(userId: string): Promise<Record<string, string>> {
    const { rows } = await this.db.query<{ key: string; value: string }>(
      `select key, value from settings where user_id = $1`,
      [userId]
    );
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async get(userId: string, key: string, fallback: string): Promise<string> {
    const { rows } = await this.db.query<{ value: string }>(
      `select value from settings where user_id = $1 and key = $2`,
      [userId, key]
    );
    return rows[0]?.value ?? fallback;
  }

  async set(userId: string, key: string, value: string): Promise<void> {
    if (value.trim() === "") {
      await this.db.query(
        `delete from settings where user_id = $1 and key = $2`,
        [userId, key]
      );
      return;
    }
    await this.db.query(
      `insert into settings (user_id, key, value) values ($1, $2, $3)
       on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`,
      [userId, key, value.slice(0, 4000)]
    );
  }

  async setMany(userId: string, entries: Record<string, string>): Promise<void> {
    for (const [k, v] of Object.entries(entries)) await this.set(userId, k, v);
  }
}

/** Keys the console Settings tab exposes, with their env-var fallback source. */
export const SETTING_KEYS = [
  "voice_tts",
  "voice_greeting",
  "voice_signoff",
  "voice_speech_timeout",
  "voice_model",
  "voice_provider",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
