/**
 * ElevenLabs text-to-speech. Generates an mp3 for a line of dialogue, which
 * Twilio then <Play>s on the call. Uses the Flash model for low latency.
 */
export class ElevenLabsClient {
  constructor(
    private opts: {
      apiKey: string;
      voiceId: string;
      /** eleven_flash_v2_5 (fast) or eleven_turbo_v2_5 / eleven_multilingual_v2. */
      modelId?: string;
      stability?: number;
      similarityBoost?: number;
    }
  ) {}

  async synthesize(text: string, voiceIdOverride?: string): Promise<Buffer> {
    const voiceId = voiceIdOverride || this.opts.voiceId;
    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
      `?output_format=mp3_22050_32`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.opts.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.slice(0, 2500),
        model_id: this.opts.modelId ?? "eleven_flash_v2_5",
        voice_settings: {
          stability: this.opts.stability ?? 0.5,
          similarity_boost: this.opts.similarityBoost ?? 0.75,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs synth failed (${res.status}): ${body.slice(0, 300)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
