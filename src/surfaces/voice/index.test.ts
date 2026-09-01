import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { verifyTwilioSignature } from "../twilio/signature.js";
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

beforeEach(async () => {
  db = await makeTestDb();
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
  voice = new VoiceSurface({
    accountSid: "AC1",
    authToken: "tok",
    fromNumber: "+15550001111",
    voice: "Polly.Brian-Neural",
    publicUrl: "https://jarvis.example.com",
    users: [{ phone: "+15551234567", userId: "colt", name: "Colt" }],
    brain,
    gate,
  });
});
afterEach(async () => {
  await db.close();
});

describe("VoiceSurface", () => {
  it("greets a known caller by name and opens a Gather", () => {
    const twiml = voice.greeting("+15551234567");
    expect(twiml).toContain("Good day, Colt");
    expect(twiml).toContain("<Gather");
    expect(twiml).toContain("Polly.Brian-Neural");
    expect(twiml).toContain("https://jarvis.example.com/twilio/voice/turn");
  });

  it("does not greet an unknown caller by name", () => {
    expect(voice.greeting("+19998887777")).toContain("recognise this number");
    expect(voice.greeting("+19998887777")).not.toContain("Colt");
  });

  it("runs a spoken turn through the brain and speaks the reply", async () => {
    const twiml = await voice.turn("+15551234567", "what's the weather");
    expect(twiml).toContain("The weather is fine.");
    expect(twiml).toContain("<Gather");
  });

  it("ends the call on goodbye without a Gather", async () => {
    const twiml = await voice.turn("+15551234567", "okay goodbye");
    expect(twiml).toContain("Goodbye");
    expect(twiml).not.toContain("<Gather");
    expect(twiml).toContain("<Hangup/>");
  });

  it("announcement for an unknown token is graceful", () => {
    expect(voice.announcementFor("nope")).toContain("expired");
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
