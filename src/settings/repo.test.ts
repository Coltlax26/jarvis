import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../../test/helpers/db.js";
import type { Db } from "../db/index.js";
import { MemoryRepo } from "../memory/repo.js";
import { SettingsRepo } from "./repo.js";

let db: Db;
let repo: SettingsRepo;

beforeEach(async () => {
  db = await makeTestDb();
  await new MemoryRepo(db).ensureUser("colt", "Colt");
  repo = new SettingsRepo(db);
});
afterEach(async () => {
  await db.close();
});

describe("SettingsRepo", () => {
  it("returns the fallback when unset, the stored value when set", async () => {
    expect(await repo.get("colt", "voice_tts", "DefaultVoice")).toBe("DefaultVoice");
    await repo.set("colt", "voice_tts", "Polly.Arthur-Neural");
    expect(await repo.get("colt", "voice_tts", "DefaultVoice")).toBe("Polly.Arthur-Neural");
  });

  it("clearing a value falls back to the default again", async () => {
    await repo.set("colt", "voice_greeting", "Hi there");
    await repo.set("colt", "voice_greeting", "");
    expect(await repo.get("colt", "voice_greeting", "Good day")).toBe("Good day");
    const all = await repo.all("colt");
    expect(all.voice_greeting).toBeUndefined();
  });

  it("setMany writes a batch and all() reads it back", async () => {
    await repo.setMany("colt", { voice_tts: "V", voice_speech_timeout: "1" });
    expect(await repo.all("colt")).toEqual({ voice_tts: "V", voice_speech_timeout: "1" });
  });
});
