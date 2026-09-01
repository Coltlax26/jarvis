import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { MemoryRepo } from "./memory/repo.js";
import { ActionRegistry } from "./actions/registry.js";
import { ActionGate } from "./actions/gate.js";
import { registerBuiltins } from "./actions/builtin/index.js";
import { Brain } from "./core/brain.js";
import { SdkRunner } from "./core/sdkRunner.js";
import { SurfaceRegistry } from "./surfaces/registry.js";
import { WebSurface } from "./surfaces/web/index.js";
import { TelegramSurface } from "./surfaces/telegram/index.js";
import { Scheduler } from "./scheduler/index.js";

const USER_ID = "colt";
const USER_NAME = "Colt";

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
  await memory.ensureUser(USER_ID, USER_NAME);

  const registry = new ActionRegistry();
  registerBuiltins(registry, { memory, db });
  const gate = new ActionGate(db, registry);

  const runner = new SdkRunner({
    model: "claude-opus-5",
    apiKey: config.anthropicApiKey,
    workspaceDir: config.workspaceDir,
  });
  const brain = new Brain({ memory, gate, registry, runner, config });

  const surfaces = new SurfaceRegistry();
  surfaces.add(
    new WebSurface({
      port: config.port,
      password: config.webPassword,
      sessionSecret: config.sessionSecret,
      userId: USER_ID,
      brain,
      gate,
      publicUrl: config.publicUrl,
    })
  );
  if (config.telegramBotToken && config.ownerTelegramId) {
    surfaces.add(
      new TelegramSurface({
        token: config.telegramBotToken,
        ownerId: config.ownerTelegramId,
        userId: USER_ID,
        brain,
        gate,
      })
    );
  } else {
    logger.warn("Telegram disabled — set TELEGRAM_BOT_TOKEN and OWNER_TELEGRAM_ID to enable");
  }

  await surfaces.startAll();

  const scheduler = new Scheduler({
    db,
    userId: USER_ID,
    deliver: (msg) => surfaces.deliver(msg),
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
