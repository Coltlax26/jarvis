import { verifyTwilioSignature } from "./signature.js";

const XML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => XML_ESCAPE[c]!);

export type TwiMLOptions = {
  /** Twilio TTS voice — a refined British male, close to the movie JARVIS. */
  voice: string;
  /** If set, <Play> this audio URL instead of <Say> (ElevenLabs). */
  playUrl?: string;
  /** Absolute URL Twilio should POST the caller's speech to. */
  actionUrl?: string;
  /** <Gather speechTimeout>: "auto" or a number of seconds. Default "auto". */
  speechTimeout?: string;
};

const speak = (text: string, opts: { voice: string; playUrl?: string }): string =>
  opts.playUrl
    ? `<Play>${esc(opts.playUrl)}</Play>`
    : `<Say voice="${esc(opts.voice)}">${esc(text)}</Say>`;

/** Build a TwiML document that speaks `text` then optionally listens for a reply. */
export function conversationTwiML(text: string, opts: TwiMLOptions): string {
  const say = speak(text, opts);
  if (!opts.actionUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Hangup/></Response>`;
  }
  // actionOnEmptyResult keeps the webhook firing even on silence, so the server
  // always knows the state of the call and can end it deliberately.
  const st = esc(opts.speechTimeout || "auto");
  const gather =
    `<Gather input="speech" language="en-US" speechModel="phone_call" ` +
    `speechTimeout="${st}" actionOnEmptyResult="true" ` +
    `action="${esc(opts.actionUrl)}" method="POST"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}${gather}</Response>`;
}

/** A one-way spoken message (proactive call, reminder). */
export function announceTwiML(
  text: string,
  opts: { voice: string; playUrl?: string }
): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `${speak(text, opts)}<Hangup/></Response>`
  );
}

export class TwilioVoiceClient {
  constructor(
    private opts: { accountSid: string; authToken: string; fromNumber: string }
  ) {}

  /**
   * Place an outbound call. Twilio fetches `twimlUrl` (POST) for what to do
   * once the callee answers.
   */
  async placeCall(to: string, twimlUrl: string): Promise<string> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Calls.json`;
    const form = new URLSearchParams({
      From: this.opts.fromNumber,
      To: to,
      Url: twimlUrl,
      Method: "POST",
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
      throw new Error(`Twilio placeCall failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { sid?: string };
    return json.sid ?? "";
  }

  verify(
    signature: string | undefined,
    fullUrl: string,
    params: Record<string, string>
  ): boolean {
    return verifyTwilioSignature(this.opts.authToken, signature, fullUrl, params);
  }
}
