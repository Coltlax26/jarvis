import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "./config.js";

const base = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  WEB_PASSWORD: "hunter2",
  SESSION_SECRET: "x".repeat(32),
};

describe("loadConfig", () => {
  it("parses a minimal valid env with PGlite fallback", () => {
    const c = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(c.anthropicApiKey).toBe("sk-ant-test");
    expect(c.databaseUrl).toBeNull();
    expect(c.port).toBe(3000);
    expect(c.tz).toBe("America/Denver");
  });

  it("collects all missing required vars into one error", () => {
    try {
      loadConfig({} as NodeJS.ProcessEnv);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain("ANTHROPIC_API_KEY");
      expect(msg).toContain("WEB_PASSWORD");
      expect(msg).toContain("SESSION_SECRET");
    }
  });

  it("passes DATABASE_URL through when set", () => {
    const c = loadConfig({
      ...base,
      DATABASE_URL: "postgres://u:p@h/db",
    } as NodeJS.ProcessEnv);
    expect(c.databaseUrl).toBe("postgres://u:p@h/db");
  });
});
