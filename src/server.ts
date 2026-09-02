import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { MemoryRepo } from "./memory/repo.js";
import { ActivityRepo } from "./activity/repo.js";
import { ActionRegistry } from "./actions/registry.js";
import { ActionGate } from "./actions/gate.js";
import { registerBuiltins } from "./actions/builtin/index.js";
import { Brain } from "./core/brain.js";
import { JarvisBus } from "./core/events.js";
import { SdkRunner } from "./core/sdkRunner.js";
import { SurfaceRegistry } from "./surfaces/registry.js";
import { WebSurface } from "./surfaces/web/index.js";
import { TelegramSurface } from "./surfaces/telegram/index.js";
import { TwilioSurface } from "./surfaces/twilio/index.js";
import { VoiceSurface } from "./surfaces/voice/index.js";
import { Scheduler } from "./scheduler/index.js";

async function main() {
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
  const bus = new JarvisBus();

  const registry = new ActionRegistry();
  registerBuiltins(registry, { memory, db });
  const gate = new ActionGate(db, registry);

  const runner = new SdkRunner({
    model: "claude-opus-5",
    apiKey: config.anthropicApiKey,
    workspaceDir: config.workspaceDir,
    anthropicWorkspaceId: config.anthropicWorkspaceId,
  });
  const voiceRunner = new SdkRunner({
    model: config.voiceModel,
    apiKey: config.anthropicApiKey,
    workspaceDir: config.workspaceDir,
    anthropicWorkspaceId: config.anthropicWorkspaceId,
    timeoutMs: 25_000,
  });
  const brain = new Brain({
    memory,
    gate,
    registry,
    runner,
    voiceRunner,
    config,
    bus,
    activity,
  });

  const surfaces = new SurfaceRegistry();

  const phoneUsers = config.users.filter((u) => u.phone);
  const baseUrl = config.publicUrl.replace(/\/$/, "");

  let twilio: TwilioSurface | undefined;
  let voice: VoiceSurface | undefined;
  if (config.twilio && phoneUsers.length) {
    twilio = new TwilioSurface({
      ...config.twilio,
      users: phoneUsers.map((u) => ({ phone: u.phone!, userId: u.id })),
      brain,
      gate,
    });
    surfaces.add(twilio);

    voice = new VoiceSurface({
      ...config.twilio,
      voice: config.voiceTts,
      publicUrl: config.publicUrl,
      users: phoneUsers.map((u) => ({ phone: u.phone!, userId: u.id, name: u.name })),
      brain,
      gate,
      bus,
    });
    surfaces.add(voice);
  } else {
    logger.warn(
      "SMS/voice disabled — set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER and give a user a phone"
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
      brain,
      gate,
      memory,
      activity,
      bus,
      db,
      sms: twilio
        ? {
            webhookUrl: `${baseUrl}/twilio/sms`,
            verify: (sig, url, params) => twilio!.verify(sig, url, params),
            userForPhone: (from) => twilio!.userForPhone(from),
            handleInbound: (from, body) => twilio!.handleInbound(from, body),
          }
        : undefined,
      voice: voice
        ? {
            incomingUrl: `${baseUrl}/twilio/voice`,
            turnUrl: `${baseUrl}/twilio/voice/turn`,
            announceUrl: `${baseUrl}/twilio/voice/announce`,
            verify: (sig, url, params) => voice!.verify(sig, url, params),
            greeting: (from) => voice!.greeting(from),
            turn: (from, speech) => voice!.turn(from, speech),
            announcementFor: (token) => voice!.announcementFor(token),
          }
        : undefined,
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

  logger.info("Jarvis is up");

  const shutdown = async () => {
    logger.info("shutting down");
    scheduler.stop();
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
