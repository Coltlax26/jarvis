import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import type { Memory, Message, Role } from "./types.js";

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .match(/[a-z0-9']+/g)
    ?.filter((w) => w.length > 2) ?? [];

export class MemoryRepo {
  constructor(private db: Db) {}

  async ensureUser(id: string, name: string, persona = ""): Promise<void> {
    await this.db.query(
      `insert into users (id, name, persona) values ($1, $2, $3)
       on conflict (id) do update set name = excluded.name, persona = excluded.persona`,
      [id, name, persona]
    );
  }

  async getUser(
    id: string
  ): Promise<{ id: string; name: string; persona: string } | null> {
    const { rows } = await this.db.query<{ id: string; name: string; persona: string }>(
      `select id, name, coalesce(persona, '') as persona from users where id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async getOrCreateConversation(userId: string): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from conversations where user_id = $1 order by created_at asc limit 1`,
      [userId]
    );
    if (rows[0]) return rows[0].id;
    const id = randomUUID();
    await this.db.query(
      `insert into conversations (id, user_id) values ($1, $2)`,
      [id, userId]
    );
    return id;
  }

  async addMessage(m: {
    conversationId: string;
    role: Role;
    surface: string;
    content: string;
  }): Promise<Message> {
    const id = randomUUID();
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into messages (id, conversation_id, role, surface, content)
       values ($1,$2,$3,$4,$5) returning *`,
      [id, m.conversationId, m.role, m.surface, m.content]
    );
    return rowToMessage(rows[0]!);
  }

  async recentMessages(
    conversationId: string,
    limit: number
  ): Promise<Message[]> {
    const n = Math.max(1, Math.min(500, Math.floor(limit)));
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from (
         select * from messages where conversation_id = $1 order by created_at desc limit ${n}
       ) t order by created_at asc`,
      [conversationId]
    );
    return rows.map(rowToMessage);
  }

  async addMemory(m: {
    userId: string;
    content: string;
    source?: string;
    keywords?: string[];
  }): Promise<Memory> {
    const id = randomUUID();
    const kw =
      m.keywords && m.keywords.length
        ? m.keywords
        : words(m.content).slice(0, 8);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into memories (id, user_id, content, source, keywords)
       values ($1,$2,$3,$4,$5) returning *`,
      [id, m.userId, m.content, m.source ?? "assistant", kw]
    );
    return rowToMemory(rows[0]!);
  }

  async listMemories(userId: string, limit = 100): Promise<Memory[]> {
    const n = Math.max(1, Math.min(500, Math.floor(limit)));
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from memories where user_id = $1 order by created_at desc limit ${n}`,
      [userId]
    );
    return rows.map(rowToMemory);
  }

  async searchMemories(
    userId: string,
    queryText: string,
    limit: number
  ): Promise<Memory[]> {
    const qWords = new Set(words(queryText));
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from memories where user_id = $1 order by created_at desc limit 200`,
      [userId]
    );
    const all = rows.map(rowToMemory);
    const scored = all
      .map((mem) => {
        const hay = new Set([
          ...mem.keywords.map((k) => k.toLowerCase()),
          ...words(mem.content),
        ]);
        let score = 0;
        for (const w of qWords) if (hay.has(w)) score++;
        return { mem, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.mem);

    const chosen = scored.length ? scored : all.slice(0, limit);
    if (chosen.length) {
      await this.db.query(
        `update memories set last_used_at = now() where id = any($1)`,
        [chosen.map((m) => m.id)]
      );
    }
    return chosen;
  }
}

function rowToMessage(r: Record<string, unknown>): Message {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    role: r.role as Role,
    surface: r.surface as string,
    content: r.content as string,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToMemory(r: Record<string, unknown>): Memory {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    content: r.content as string,
    source: r.source as string,
    keywords: (r.keywords as string[]) ?? [],
    createdAt: new Date(r.created_at as string),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string) : null,
  };
}
