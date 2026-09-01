import { createHmac } from "node:crypto";

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

  /**
   * Verify an inbound Twilio webhook request.
   * https://www.twilio.com/docs/usage/security#validating-requests
   */
  verifySignature(
    signature: string | undefined,
    fullUrl: string,
    params: Record<string, string>
  ): boolean {
    if (!signature) return false;
    const sorted = Object.keys(params).sort();
    let data = fullUrl;
    for (const key of sorted) data += key + params[key];
    const expected = createHmac("sha1", this.opts.authToken)
      .update(Buffer.from(data, "utf-8"))
      .digest("base64");
    // constant-time-ish compare
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  }
}
