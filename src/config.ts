export class ConfigError extends Error {}

export type UserTheme = {
  mode: "hud" | "light";
  accent: string | null;
  background: string | null;
  /** How to place the background image: "cover" fills the screen, "watermark"
   *  shows it small and faint (good for a logo). */
  backgroundFit: "cover" | "watermark";
  brand: string | null;
  /** URL of a logo shown in the top bar next to the JARVIS mark. */
  logo: string | null;
};

export type JarvisUser = {
  id: string;
  name: string;
  password: string;
  telegramId: string | null;
  persona: string;
  theme: UserTheme;
};

function parseTheme(rec: Record<string, unknown>): UserTheme {
  const t = (rec.theme as Record<string, unknown> | undefined) ?? {};
  const mode = t.mode === "light" ? "light" : "hud";
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  return {
    mode,
    accent: str(t.accent),
    background: str(t.background),
    backgroundFit: t.backgroundFit === "cover" ? "cover" : "watermark",
    brand: str(t.brand),
    logo: str(t.logo),
  };
}

export type Config = {
  /**
   * Only set when the owner wants pay-per-token API billing. Left null, the
   * Agent SDK falls back to the machine's `claude` login (Claude subscription).
   */
  anthropicApiKey: string | null;
  databaseUrl: string | null;
  users: JarvisUser[];
  sessionSecret: string;
  telegramBotToken: string | null;
  /** Main model for chat/text turns. */
  model: string;
  /** Google OAuth (Gmail + Calendar). Inert until both halves are set. */
  google: { clientId: string; clientSecret: string } | null;
  tz: string;
  workspaceDir: string;
  publicUrl: string;
  port: number;
  nodeEnv: "development" | "production" | "test";
};

const idFromName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";

function parseUsers(env: NodeJS.ProcessEnv): JarvisUser[] {
  // Preferred: JARVIS_USERS as a JSON array of { name, password, id?, telegramId? }.
  const raw = env.JARVIS_USERS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConfigError("JARVIS_USERS is not valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new ConfigError("JARVIS_USERS must be a non-empty JSON array");
    }
    const users: JarvisUser[] = parsed.map((u, i) => {
      const rec = u as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      const password = typeof rec.password === "string" ? rec.password : "";
      if (!name) throw new ConfigError(`JARVIS_USERS[${i}] is missing "name"`);
      if (!password) throw new ConfigError(`JARVIS_USERS[${i}] is missing "password"`);
      return {
        id: typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : idFromName(name),
        name,
        password,
        telegramId:
          typeof rec.telegramId === "string" && rec.telegramId.trim()
            ? rec.telegramId.trim()
            : rec.telegramId != null
              ? String(rec.telegramId)
              : null,
        persona: typeof rec.persona === "string" ? rec.persona.trim() : "",
        theme: parseTheme(rec),
      };
    });
    assertUniqueUsers(users);
    return users;
  }

  // Fallback: a single user from WEB_PASSWORD (name from WEB_USER_NAME or "Colt").
  const password = env.WEB_PASSWORD?.trim();
  if (!password) {
    throw new ConfigError(
      "Set either JARVIS_USERS (JSON array) or WEB_PASSWORD (single user)"
    );
  }
  const name = env.WEB_USER_NAME?.trim() || "Colt";
  return [
    {
      id: idFromName(name),
      name,
      password,
      telegramId: env.OWNER_TELEGRAM_ID?.trim() || null,
      persona: env.WEB_USER_PERSONA?.trim() || "",
      theme: {
        mode: "hud",
        accent: null,
        background: null,
        backgroundFit: "watermark",
        brand: null,
        logo: null,
      },
    },
  ];
}

function assertUniqueUsers(users: JarvisUser[]): void {
  const ids = new Set<string>();
  const passwords = new Set<string>();
  for (const u of users) {
    if (ids.has(u.id)) throw new ConfigError(`Duplicate user id: ${u.id}`);
    if (passwords.has(u.password)) {
      throw new ConfigError("Two users share a password — passwords must be unique");
    }
    ids.add(u.id);
    passwords.add(u.password);
  }
}

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

  const sessionSecret = req("SESSION_SECRET");

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  const users = parseUsers(env);

  // Convenience: OWNER_TELEGRAM_ID attaches to the first user if that user has
  // no telegramId of their own. Lets you enable Telegram without hand-editing
  // the JARVIS_USERS JSON.
  const owner = env.OWNER_TELEGRAM_ID?.trim();
  if (owner && users[0] && !users[0].telegramId) {
    users[0].telegramId = owner;
  }

  const nodeEnvRaw = env.NODE_ENV ?? "development";
  const nodeEnv =
    nodeEnvRaw === "production" || nodeEnvRaw === "test"
      ? nodeEnvRaw
      : "development";

  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    databaseUrl: env.DATABASE_URL?.trim() ? env.DATABASE_URL.trim() : null,
    users,
    sessionSecret,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() || null,
    model: env.JARVIS_MODEL?.trim() || "claude-sonnet-5",
    google:
      env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()
        ? {
            clientId: env.GOOGLE_CLIENT_ID.trim(),
            clientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
          }
        : null,
    tz: env.TZ?.trim() || "America/Denver",
    workspaceDir: env.WORKSPACE_DIR?.trim() || "./workspace",
    publicUrl: env.PUBLIC_URL?.trim() || "http://localhost:3000",
    port: Number.parseInt(env.PORT ?? "3000", 10) || 3000,
    nodeEnv,
  };
}
