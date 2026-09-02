import { describe, it, expect, vi, afterEach } from "vitest";
import { ElevenLabsClient } from "./client.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("ElevenLabsClient", () => {
  it("posts to the voice endpoint and returns the audio bytes", async () => {
    const seen: { url: string; init: RequestInit } = { url: "", init: {} };
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.init = init;
      return new Response(Buffer.from("mp3-bytes"), { status: 200 });
    }) as typeof fetch;

    const client = new ElevenLabsClient({ apiKey: "key-123", voiceId: "voiceA" });
    const out = await client.synthesize("Hello there");

    expect(out.toString()).toBe("mp3-bytes");
    expect(seen.url).toContain("/text-to-speech/voiceA");
    expect((seen.init.headers as Record<string, string>)["xi-api-key"]).toBe("key-123");
    const body = JSON.parse(seen.init.body as string);
    expect(body.text).toBe("Hello there");
    expect(body.model_id).toBe("eleven_flash_v2_5");
  });

  it("honours a per-call voice id override", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string) => {
      calledUrl = url;
      return new Response(Buffer.from("x"), { status: 200 });
    }) as typeof fetch;
    const client = new ElevenLabsClient({ apiKey: "k", voiceId: "default" });
    await client.synthesize("hi", "override-voice");
    expect(calledUrl).toContain("/text-to-speech/override-voice");
  });

  it("throws with the status and body on a failed response", async () => {
    globalThis.fetch = (async () =>
      new Response("quota exceeded", { status: 401 })) as typeof fetch;
    const client = new ElevenLabsClient({ apiKey: "k", voiceId: "v" });
    await expect(client.synthesize("hi")).rejects.toThrow(/401.*quota exceeded/);
  });
});
