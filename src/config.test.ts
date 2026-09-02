import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "./config.js";

const base = {
  SESSION_SECRET: "x".repeat(32),
};

describe("loadConfig", () => {
  it("falls back to a single user from WEB_PASSWORD", () => {
    const c = loadConfig({ ...base, WEB_PASSWORD: "hunter2" } as NodeJS.ProcessEnv);
    expect(c.users).toHaveLength(1);
    expect(c.users[0]).toMatchObject({ id: "colt", name: "Colt", password: "hunter2" });
    expect(c.databaseUrl).toBeNull();
    expect(c.port).toBe(3000);
  });

  it("names the single fallback user from WEB_USER_NAME", () => {
    const c = loadConfig({
      ...base,
      WEB_PASSWORD: "pw",
      WEB_USER_NAME: "Rich",
    } as NodeJS.ProcessEnv);
    expect(c.users[0]).toMatchObject({ id: "rich", name: "Rich" });
  });

  it("parses JARVIS_USERS as a JSON array", () => {
    const c = loadConfig({
      ...base,
      JARVIS_USERS: JSON.stringify([
        { name: "Colt", password: "a", telegramId: "111" },
        { name: "Rich", password: "b" },
      ]),
    } as NodeJS.ProcessEnv);
    expect(c.users.map((u) => u.name)).toEqual(["Colt", "Rich"]);
    expect(c.users[0]).toMatchObject({ id: "colt", telegramId: "111" });
    expect(c.users[1]).toMatchObject({ id: "rich", telegramId: null });
  });

  it("rejects JARVIS_USERS with a shared password", () => {
    expect(() =>
      loadConfig({
        ...base,
        JARVIS_USERS: JSON.stringify([
          { name: "Colt", password: "same" },
          { name: "Rich", password: "same" },
        ]),
      } as NodeJS.ProcessEnv)
    ).toThrow(ConfigError);
  });

  it("errors when neither JARVIS_USERS nor WEB_PASSWORD is set", () => {
    expect(() => loadConfig({ ...base } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it("requires SESSION_SECRET", () => {
    try {
      loadConfig({} as NodeJS.ProcessEnv);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).message).toContain("SESSION_SECRET");
    }
  });

  it("defaults to subscription auth (no API key) but keeps one if given", () => {
    const free = loadConfig({ ...base, WEB_PASSWORD: "pw" } as NodeJS.ProcessEnv);
    expect(free.anthropicApiKey).toBeNull();
    const paid = loadConfig({
      ...base,
      WEB_PASSWORD: "pw",
      ANTHROPIC_API_KEY: "sk-ant-test",
    } as NodeJS.ProcessEnv);
    expect(paid.anthropicApiKey).toBe("sk-ant-test");
  });

  it("passes DATABASE_URL through when set", () => {
    const c = loadConfig({
      ...base,
      WEB_PASSWORD: "pw",
      DATABASE_URL: "postgres://u:p@h/db",
    } as NodeJS.ProcessEnv);
    expect(c.databaseUrl).toBe("postgres://u:p@h/db");
  });

  it("defaults the model to claude-sonnet-5, overridable by JARVIS_MODEL", () => {
    expect(loadConfig({ ...base, WEB_PASSWORD: "pw" } as NodeJS.ProcessEnv).model).toBe(
      "claude-sonnet-5"
    );
    expect(
      loadConfig({
        ...base,
        WEB_PASSWORD: "pw",
        JARVIS_MODEL: "claude-haiku-4-5",
      } as NodeJS.ProcessEnv).model
    ).toBe("claude-haiku-4-5");
  });
});
