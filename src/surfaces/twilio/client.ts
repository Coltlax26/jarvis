import { verifyTwilioSignature } from "./signature.js";

/**
 * Minimal Twilio client — sends SMS and validates inbound webhook signatures.
 * No SDK dependency; just the REST API over fetch.
 */
export class TwilioClient {
  constructor(
    private opts: { accountSid: string; authToken: string; fromNumber: string }
  ) {}

  async sendSms(to: string, body: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`;
    const form = new URLSearchParams({
      From: this.opts.fromNumber,
      To: to,
      // Twilio hard-caps a single SMS segment; long replies are split by Twilio
      // automatically, but keep a sane ceiling.
      Body: body.slice(0, 1500),
    });
    const auth = Buffer.from(
      `${this.opts.accountSid}:${this.opts.authToken}`
    ).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Twilio sendSms failed (${res.status}): ${text.slice(0, 300)}`);
    }
  }

  verifySignature(
    signature: string | undefined,
    fullUrl: string,
    params: Record<string, string>
  ): boolean {
    return verifyTwilioSignature(this.opts.authToken, signature, fullUrl, params);
  }
}
