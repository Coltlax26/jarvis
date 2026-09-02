import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { MemoryRepo } from "./memory/repo.js";
import { ActivityRepo } from "./activity/repo.js";
import { SettingsRepo } from "./settings/repo.js";
import { ActionRegistry } from "./actions/registry.js";
import { ActionGate } from "./actions/gate.js";
import { registerBuiltins } from "./actions/builtin/index.js";
import { Brain } from "./core/brain.js";
import { JarvisBus } from "./core/events.js";
import { SdkRunner } from "./core/sdkRunner.js";
import { SurfaceRegistry } from "./surfaces/registry.js";
import { WebSurface } from "./surfaces/web/index.js";
import { TelegramSurface } from "./surfaces/telegram/index.js";
import { GoogleTokenRepo } from "./surfaces/google/repo.js";
import { GoogleClient } from "./surfaces/google/client.js";
import { BrowserRunner } from "./surfaces/browser/runner.js";
import { BrowseService } from "./surfaces/browser/service.js";
import { MacControl } from "./surfaces/mac/control.js";
import { Scheduler } from "./scheduler/index.js";
import { CalendarReminderJob } from "./scheduler/calendarReminders.js";

async function main() {
  // A stray rejection (e.g. a background polling loop) must be logged, not
  // allowed to take the whole service down.
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled rejection", reason);
  });

  const config = loadConfig();
  await mkdir(config.workspaceDir, { recursive: true });

  const db = await createDb({
    databaseUrl: config.databaseUrl,
    pgliteDir: config.databaseUrl ? undefined : `${config.workspaceDir}/dev.pglite`,
  });
  const { applied } = await runMigrations(db);
  logger.info("migrations complete", { applied });

  const memory = new MemoryRepo(db);
  for (const u of config.users) {
    await memory.ensureUser(u.id, u.name, u.persona);
  }
  logger.info("users ready", { users: config.users.map((u) => u.name) });

  const activity = new ActivityRepo(db);
  const settings = new SettingsRepo(db);
  const bus = new JarvisBus();

  const registry = new ActionRegistry();
  const gate = new ActionGate(db, registry);

  const browse = new BrowseService({
    runner: new BrowserRunner(),
    publicUrl: config.publicUrl,
    bus,
  });

  const mac = process.platform === "darwin" ? new MacControl() : null;
  logger.info("local capabilities", {
    chromium: browse.available(),
    macControl: Boolean(mac),
  });

  const googleTokens = new GoogleTokenRepo(db);
  const google = config.google
    ? new GoogleClient({
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        redirectUri: `${config.publicUrl.replace(/\/$/, "")}/auth/google/callback`,
        tokens: googleTokens,
      })
    : undefined;

  const runner = new SdkRunner({
    model: config.model,
    workspaceDir: config.workspaceDir,
  });
  logger.info("model", {
    main: config.model,
    auth: config.anthropicApiKey ? "API key" : "claude subscription (free)",
  });

  const brain = new Brain({
    memory,
    gate,
    registry,
    runner,
    config,
    bus,
    activity,
    settings,
  });

  const surfaces = new SurfaceRegistry();

  registerBuiltins(registry, {
    memory,
    db,
    google,
    browse: { run: (userId, input) => browse.run(userId, input) },
    mac: mac ?? undefined,
  });
  if (!google) {
    logger.warn(
      "Google (Gmail + Calendar) disabled — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"
    );
  }

  surfaces.add(
    new WebSurface({
      port: config.port,
      users: config.users,
      sessionSecret: config.sessionSecret,
      publicUrl: config.publicUrl,
      databaseUrl: config.databaseUrl,
      tz: config.tz,
      model: config.model,
      brain,
      gate,
      memory,
      activity,
      settings,
      settingDefaults: {},
      bus,
      db,
      google: google
        ? {
            authUrl: (state) => google.authUrl(state),
            connect: (userId, code) => google.connect(userId, code),
            isConnected: (userId) => google.isConnected(userId),
            disconnect: (userId) => google.disconnect(userId),
          }
        : undefined,
      browseShot: (id) => browse.shotFor(id),
    })
  );

  const telegramUsers = config.users.filter((u) => u.telegramId);
  if (config.telegramBotToken && telegramUsers.length) {
    surfaces.add(
      new TelegramSurface({
        token: config.telegramBotToken,
        brain,
        gate,
        users: telegramUsers.map((u) => ({ telegramId: u.telegramId!, userId: u.id })),
      })
    );
  } else {
    logger.warn(
      "Telegram disabled — set TELEGRAM_BOT_TOKEN and give at least one user a telegramId"
    );
  }

  await surfaces.startAll();

  const scheduler = new Scheduler({
    db,
    deliver: async (msg) => {
      await surfaces.deliver(msg);
      await activity.log({ userId: msg.userId, kind: "reminder_sent", summary: msg.text });
    },
  });
  scheduler.start();

  const telegramById = new Map(
    config.users.filter((u) => u.telegramId).map((u) => [u.id, true])
  );
  const calendarJob = google
    ? new CalendarReminderJob({
        db,
        google,
        tokens: googleTokens,
        channelFor: (id) => (telegramById.has(id) ? "telegram" : "web"),
      })
    : null;
  calendarJob?.start();

  logger.info("Jarvis is up");

  const shutdown = async () => {
    logger.info("shutting down");
    scheduler.stop();
    calendarJob?.stop();
    await surfaces.stopAll();
    await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error("fatal boot error", err);
  process.exit(1);
});
