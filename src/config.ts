export class ConfigError extends Error {}

export type Config = {
  anthropicApiKey: string;
  databaseUrl: string | null;
  webPassword: string;
  sessionSecret: string;
  telegramBotToken: string | null;
  ownerTelegramId: string | null;
  tz: string;
  workspaceDir: string;
  publicUrl: string;
  port: number;
  nodeEnv: "development" | "production" | "test";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const req = (k: string): string => {
    const v = env[k];
    if (!v || v.trim() === "") {
      missing.push(k);
      return "";
    }
    return v;
  };

  const anthropicApiKey = req("ANTHROPIC_API_KEY");
  const webPassword = req("WEB_PASSWORD");
  const sessionSecret = req("SESSION_SECRET");

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  const nodeEnvRaw = env.NODE_ENV ?? "development";
  const nodeEnv =
    nodeEnvRaw === "production" || nodeEnvRaw === "test"
      ? nodeEnvRaw
      : "development";

  return {
    anthropicApiKey,
    databaseUrl: env.DATABASE_URL?.trim() ? env.DATABASE_URL.trim() : null,
    webPassword,
    sessionSecret,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() || null,
    ownerTelegramId: env.OWNER_TELEGRAM_ID?.trim() || null,
    tz: env.TZ?.trim() || "America/Denver",
    workspaceDir: env.WORKSPACE_DIR?.trim() || "./workspace",
    publicUrl: env.PUBLIC_URL?.trim() || "http://localhost:3000",
    port: Number.parseInt(env.PORT ?? "3000", 10) || 3000,
    nodeEnv,
  };
}
