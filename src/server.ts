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
import { DirectRunner } from "./core/directRunner.js";
import { SurfaceRegistry } from "./surfaces/registry.js";
import { WebSurface } from "./surfaces/web/index.js";
import { TelegramSurface } from "./surfaces/telegram/index.js";
import { TwilioSurface } from "./surfaces/twilio/index.js";
import { VoiceSurface } from "./surfaces/voice/index.js";
import type { VoiceResolved } from "./surfaces/voice/index.js";
import { OutboundCallRepo } from "./surfaces/voice/calls.js";
import { ElevenLabsClient } from "./surfaces/elevenlabs/client.js";
import { GoogleTokenRepo } from "./surfaces/google/repo.js";
import { GoogleClient } from "./surfaces/google/client.js";
import { BrowserRunner } from "./surfaces/browser/runner.js";
import { BrowseService } from "./surfaces/browser/service.js";
import { Scheduler } from "./scheduler/index.js";
import { CalendarReminderJob } from "./scheduler/calendarReminders.js";

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
  const settings = new SettingsRepo(db);
  const bus = new JarvisBus();

  const elevenLabs = config.elevenLabs
    ? new ElevenLabsClient({
        apiKey: config.elevenLabs.apiKey,
        voiceId: config.elevenLabs.voiceId,
      })
    : undefined;

  // Live per-user voice overrides: console setting, else env/JARVIS_USERS default.
  const resolveVoice = async (
    userId: string,
    base: VoiceResolved
  ): Promise<VoiceResolved> => {
    const all = await settings.all(userId);
    const provider =
      all.voice_provider?.trim() === "elevenlabs" && elevenLabs
        ? "elevenlabs"
        : all.voice_provider?.trim() === "twilio"
          ? "twilio"
          : base.provider;
    return {
      voice: all.voice_tts?.trim() || base.voice,
      greeting: all.voice_greeting?.trim() || base.greeting,
      signoff: all.voice_signoff?.trim() || base.signoff,
      speechTimeout: all.voice_speech_timeout?.trim() || base.speechTimeout,
      provider,
      elVoiceId: all.voice_el_voice_id?.trim() || base.elVoiceId || null,
    };
  };

  const registry = new ActionRegistry();
  const gate = new ActionGate(db, registry);
  const outboundCalls = new OutboundCallRepo(db);

  const browse = new BrowseService({
    runner: new BrowserRunner(),
    publicUrl: config.publicUrl,
    bus,
  });
  logger.info("browser groundwork", { chromium: browse.available() });

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
    model: "claude-opus-5",
    apiKey: config.anthropicApiKey,
    workspaceDir: config.workspaceDir,
    anthropicWorkspaceId: config.anthropicWorkspaceId,
  });
  // Voice turns use a direct Messages API call (no agent subprocess) so replies
  // come back in ~1-3s instead of ~5-8s.
  const voiceRunner = new DirectRunner({
    model: config.voiceModel,
    apiKey: config.anthropicApiKey,
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
      speechTimeout: config.voiceSpeechTimeout,
      publicUrl: config.publicUrl,
      users: phoneUsers.map((u) => ({
        phone: u.phone!,
        userId: u.id,
        name: u.name,
        greeting: u.voiceGreeting,
        signoff: u.voiceSignoff,
      })),
      brain,
      gate,
      bus,
      activity,
      elevenLabs,
      calls: outboundCalls,
      outboundRunner: voiceRunner,
      ownerName: (id) => config.users.find((u) => u.id === id)?.name ?? "Colt",
      resolve: resolveVoice,
    });
    surfaces.add(voice);
  } else {
    logger.warn(
      "SMS/voice disabled — set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER and give a user a phone"
    );
  }

  registerBuiltins(registry, {
    memory,
    db,
    placeOutbound: voice ? (input) => voice!.placeOutboundCall(input) : undefined,
    google,
    browse: { run: (userId, input) => browse.run(userId, input) },
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
      brain,
      gate,
      memory,
      activity,
      settings,
      settingDefaults: {
        voice_tts: config.voiceTts,
        voice_greeting: "",
        voice_signoff: "",
        voice_speech_timeout: config.voiceSpeechTimeout,
        voice_model: config.voiceModel,
        voice_provider: config.elevenLabs ? "elevenlabs" : config.twilio ? "twilio" : "",
        voice_el_voice_id: "",
      },
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
            statusUrl: `${baseUrl}/twilio/voice/status`,
            verify: (sig, url, params) => voice!.verify(sig, url, params),
            greeting: (from, sid) => voice!.greeting(from, sid),
            turn: (from, speech, sid) => voice!.turn(from, speech, sid),
            callStatus: (sid, status) => voice!.callStatus(sid, status),
            announcementFor: (token) => voice!.announcementFor(token),
            audioFor: (id) => voice!.audioFor(id),
            activeCalls: () => voice!.activeCalls(),
            outbound: {
              incomingUrl: voice.outboundUrls().incoming,
              turnUrl: voice.outboundUrls().turn,
              statusUrl: voice.outboundUrls().status,
              greeting: (id, sid) => voice!.outboundGreeting(id, sid),
              turn: (id, sid, speech) => voice!.outboundTurn(id, sid, speech),
              status: (id, s) => voice!.outboundStatus(id, s),
              history: (ownerId) => voice!.outboundHistory(ownerId),
            },
          }
        : undefined,
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

  const calendarJob = google
    ? new CalendarReminderJob({ db, google, tokens: googleTokens })
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
