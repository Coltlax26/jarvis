import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "./config.js";

const base = {
  ANTHROPIC_API_KEY: "sk-ant-test",
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

  it("collects missing core vars into one error", () => {
    try {
      loadConfig({} as NodeJS.ProcessEnv);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain("ANTHROPIC_API_KEY");
      expect(msg).toContain("SESSION_SECRET");
    }
  });

  it("parses user phone numbers to E.164 and reads Twilio config", () => {
    const c = loadConfig({
      ...base,
      JARVIS_USERS: JSON.stringify([{ name: "Colt", password: "a", phone: "(555) 123-4567" }]),
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "tok",
      TWILIO_FROM_NUMBER: "555-000-1111",
    } as NodeJS.ProcessEnv);
    expect(c.users[0]!.phone).toBe("+15551234567");
    expect(c.twilio).toEqual({ accountSid: "AC1", authToken: "tok", fromNumber: "+15550001111" });
  });

  it("leaves Twilio null when creds are incomplete", () => {
    const c = loadConfig({
      ...base,
      WEB_PASSWORD: "pw",
      TWILIO_ACCOUNT_SID: "AC1",
    } as NodeJS.ProcessEnv);
    expect(c.twilio).toBeNull();
  });

  it("passes DATABASE_URL through when set", () => {
    const c = loadConfig({
      ...base,
      WEB_PASSWORD: "pw",
      DATABASE_URL: "postgres://u:p@h/db",
    } as NodeJS.ProcessEnv);
    expect(c.databaseUrl).toBe("postgres://u:p@h/db");
  });
});
