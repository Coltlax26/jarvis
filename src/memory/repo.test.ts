import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "./repo.js";

let db: Db;
let repo: MemoryRepo;

beforeEach(async () => {
  db = await makeTestDb();
  repo = new MemoryRepo(db);
  await repo.ensureUser("colt", "Colt");
});
afterEach(async () => {
  await db.close();
});

describe("MemoryRepo", () => {
  it("creates one conversation and reuses it", async () => {
    const a = await repo.getOrCreateConversation("colt");
    const b = await repo.getOrCreateConversation("colt");
    expect(a).toBe(b);
  });

  it("stores and returns messages oldest-first", async () => {
    const conv = await repo.getOrCreateConversation("colt");
    await repo.addMessage({
      conversationId: conv,
      role: "user",
      surface: "web",
      content: "hi",
    });
    await repo.addMessage({
      conversationId: conv,
      role: "assistant",
      surface: "web",
      content: "hello",
    });
    const msgs = await repo.recentMessages(conv, 10);
    expect(msgs.map((m) => m.content)).toEqual(["hi", "hello"]);
  });

  it("finds memories by keyword and falls back to recent", async () => {
    await repo.addMemory({
      userId: "colt",
      content: "Colt's dog is named Rex",
      keywords: ["dog", "rex"],
    });
    await repo.addMemory({
      userId: "colt",
      content: "Colt prefers plain writing",
      keywords: ["writing", "style"],
    });
    const hit = await repo.searchMemories("colt", "what is my dog called", 5);
    expect(hit.some((m) => m.content.includes("Rex"))).toBe(true);

    const fallback = await repo.searchMemories(
      "colt",
      "completely unrelated xyzzy",
      1
    );
    expect(fallback).toHaveLength(1);
  });
});
