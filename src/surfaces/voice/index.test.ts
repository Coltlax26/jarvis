import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { verifyTwilioSignature } from "../twilio/signature.js";
import { JarvisBus, type JarvisEvent } from "../../core/events.js";
import { makeTestDb } from "../../../test/helpers/db.js";
import type { Db } from "../../db/index.js";
import { MemoryRepo } from "../../memory/repo.js";
import { ActionRegistry } from "../../actions/registry.js";
import { ActionGate } from "../../actions/gate.js";
import { registerBuiltins } from "../../actions/builtin/index.js";
import { Brain } from "../../core/brain.js";
import { FakeRunner } from "../../core/fakeRunner.js";
import type { Config } from "../../config.js";
import { VoiceSurface } from "./index.js";

let db: Db;
let voice: VoiceSurface;
let events: JarvisEvent[];

beforeEach(async () => {
  db = await makeTestDb();
  events = [];
  const memory = new MemoryRepo(db);
  await memory.ensureUser("colt", "Colt");
  const registry = new ActionRegistry();
  registerBuiltins(registry, { memory, db });
  const gate = new ActionGate(db, registry);
  const cfg: Pick<Config, "tz" | "workspaceDir"> = {
    tz: "America/New_York",
    workspaceDir: "./workspace",
  };
  const brain = new Brain({
    memory,
    gate,
    registry,
    runner: new FakeRunner([{ say: "The weather is fine." }]),
    config: cfg,
  });
  const bus = new JarvisBus();
  bus.subscribe("colt", (e) => events.push(e));
  voice = new VoiceSurface({
    accountSid: "AC1",
    authToken: "tok",
    fromNumber: "+15550001111",
    voice: "Polly.Brian-Neural",
    publicUrl: "https://jarvis.example.com",
    users: [{ phone: "+15551234567", userId: "colt", name: "Colt", greeting: null, signoff: null }],
    brain,
    gate,
    bus,
  });
});
afterEach(async () => {
  await db.close();
});

describe("VoiceSurface", () => {
  it("greets a known caller by name and opens a Gather", async () => {
    const twiml = await voice.greeting("+15551234567", "CA1");
    expect(twiml).toContain("Good day, Colt");
    expect(twiml).toContain("<Gather");
    expect(twiml).toContain("Polly.Brian-Neural");
    expect(twiml).toContain("https://jarvis.example.com/twilio/voice/turn");
  });

  it("does not greet an unknown caller by name", async () => {
    expect(await voice.greeting("+19998887777", "CA9")).toContain("recognise this number");
    expect(await voice.greeting("+19998887777", "CA9")).not.toContain("Colt");
  });

  it("runs a spoken turn through the brain and speaks the reply", async () => {
    const twiml = await voice.turn("+15551234567", "what's the weather", "CA1");
    expect(twiml).toContain("The weather is fine.");
    expect(twiml).toContain("<Gather");
  });

  it("ends the call on goodbye without a Gather", async () => {
    const twiml = await voice.turn("+15551234567", "okay goodbye", "CA1");
    expect(twiml).toContain("Goodbye");
    expect(twiml).not.toContain("<Gather");
    expect(twiml).toContain("<Hangup/>");
  });

  it("announcement for an unknown token is graceful", async () => {
    expect(await voice.announcementFor("nope")).toContain("expired");
  });

  it("streams call events to the bus for the live console", async () => {
    await voice.greeting("+15551234567", "CA1");
    await voice.turn("+15551234567", "what's the weather", "CA1");
    await voice.turn("+15551234567", "okay goodbye", "CA1");
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("call_started");
    expect(kinds).toContain("call_ended");
    const transcript = events
      .filter((e) => e.kind === "call_transcript")
      .map((e) => `${(e.data as { speaker: string }).speaker}:${e.text}`);
    expect(transcript).toContain("caller:what's the weather");
    expect(transcript).toContain("jarvis:The weather is fine.");
  });

  it("uses <Play> with a generated audio URL when the ElevenLabs engine is on", async () => {
    const calls: string[] = [];
    const el = {
      synthesize: async (text: string) => {
        calls.push(text);
        return Buffer.from("ID3fake-mp3");
      },
    };
    const memory = new MemoryRepo(db);
    const registry = new ActionRegistry();
    registerBuiltins(registry, { memory, db });
    const gate = new ActionGate(db, registry);
    const brain = new Brain({
      memory,
      gate,
      registry,
      runner: new FakeRunner([{ say: "Understood." }]),
      config: { tz: "UTC", workspaceDir: "./workspace" } as Pick<Config, "tz" | "workspaceDir">,
    });
    const elVoice = new VoiceSurface({
      accountSid: "AC1",
      authToken: "tok",
      fromNumber: "+15550001111",
      voice: "Polly.Brian-Neural",
      publicUrl: "https://jarvis.example.com",
      users: [{ phone: "+15551234567", userId: "colt", name: "Colt", greeting: null, signoff: null }],
      brain,
      gate,
      elevenLabs: el as unknown as ConstructorParameters<typeof VoiceSurface>[0]["elevenLabs"],
    });
    const twiml = await elVoice.greeting("+15551234567", "CA2");
    expect(calls.length).toBe(1);
    expect(twiml).toContain("<Play>");
    expect(twiml).not.toContain("<Say");
    const m = twiml.match(/\/voice\/audio\/([a-f0-9-]+)\.mp3/);
    expect(m).not.toBeNull();
    expect(elVoice.audioFor(m![1]!)?.toString()).toBe("ID3fake-mp3");
  });

  it("falls back to <Say> when ElevenLabs synthesis throws", async () => {
    const el = {
      synthesize: async () => {
        throw new Error("EL down");
      },
    };
    const memory = new MemoryRepo(db);
    const registry = new ActionRegistry();
    registerBuiltins(registry, { memory, db });
    const gate = new ActionGate(db, registry);
    const brain = new Brain({
      memory,
      gate,
      registry,
      runner: new FakeRunner([{ say: "ok" }]),
      config: { tz: "UTC", workspaceDir: "./workspace" } as Pick<Config, "tz" | "workspaceDir">,
    });
    const elVoice = new VoiceSurface({
      accountSid: "AC1",
      authToken: "tok",
      fromNumber: "+15550001111",
      voice: "Polly.Brian-Neural",
      publicUrl: "https://jarvis.example.com",
      users: [{ phone: "+15551234567", userId: "colt", name: "Colt", greeting: null, signoff: null }],
      brain,
      gate,
      elevenLabs: el as unknown as ConstructorParameters<typeof VoiceSurface>[0]["elevenLabs"],
    });
    const twiml = await elVoice.greeting("+15551234567", "CA3");
    expect(twiml).toContain("<Say");
    expect(twiml).not.toContain("<Play>");
  });

  it("verifies its own signature scheme", () => {
    const params: Record<string, string> = { CallSid: "CA1", From: "+15551234567" };
    const url = "https://jarvis.example.com/twilio/voice";
    let data = url;
    for (const k of Object.keys(params).sort()) data += k + params[k];
    const sig = createHmac("sha1", "tok").update(Buffer.from(data, "utf-8")).digest("base64");
    expect(voice.verify(sig, url, params)).toBe(true);
    expect(voice.verify("bad", url, params)).toBe(false);
    expect(verifyTwilioSignature("tok", sig, url, params)).toBe(true);
  });
});
