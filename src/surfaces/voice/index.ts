import { randomUUID } from "node:crypto";
import { logger } from "../../logger.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { JarvisBus, JarvisEventKind } from "../../core/events.js";
import type { Surface } from "../types.js";
import { parseCommand } from "../telegram/parse.js";
import {
  TwilioVoiceClient,
  announceTwiML,
  conversationTwiML,
} from "../twilio/voiceClient.js";

type VoiceUser = { phone: string; userId: string; name: string };

const isGoodbye = (s: string): boolean =>
  /\b(good\s?bye|bye now|hang up|that'?s all|nothing else|talk later|we'?re done)\b/i.test(s);

export class VoiceSurface implements Surface {
  readonly name = "voice";
  private client: TwilioVoiceClient;
  private byPhone: Map<string, VoiceUser>;
  private byUserId: Map<string, VoiceUser>;
  private voice: string;
  private turnUrl: string;
  private incomingUrl: string;
  private announceBase: string;
  private announcements = new Map<string, { text: string; expires: number }>();

  constructor(
    private deps: {
      accountSid: string;
      authToken: string;
      fromNumber: string;
      voice: string;
      publicUrl: string;
      users: VoiceUser[];
      brain: Brain;
      gate: ActionGate;
      bus?: JarvisBus;
    }
  ) {
    this.client = new TwilioVoiceClient({
      accountSid: deps.accountSid,
      authToken: deps.authToken,
      fromNumber: deps.fromNumber,
    });
    this.byPhone = new Map(deps.users.map((u) => [u.phone, u]));
    this.byUserId = new Map(deps.users.map((u) => [u.userId, u]));
    this.voice = deps.voice;
    const base = deps.publicUrl.replace(/\/$/, "");
    this.incomingUrl = `${base}/twilio/voice`;
    this.turnUrl = `${base}/twilio/voice/turn`;
    this.announceBase = `${base}/twilio/voice/announce`;
  }

  verify(sig: string | undefined, url: string, params: Record<string, string>): boolean {
    return this.client.verify(sig, url, params);
  }

  private emit(userId: string, kind: JarvisEventKind, text: string, data?: unknown): void {
    this.deps.bus?.publish(userId, {
      kind,
      text,
      at: new Date().toISOString(),
      surface: "voice",
      data,
    });
  }

  urls(): { incoming: string; turn: string; announce: string } {
    return { incoming: this.incomingUrl, turn: this.turnUrl, announce: this.announceBase };
  }

  userForPhone(from: string): VoiceUser | undefined {
    return this.byPhone.get(from);
  }

  /** TwiML for an inbound call. */
  greeting(from: string): string {
    const user = this.byPhone.get(from);
    const hello = user
      ? `Good day, ${user.name}. Jarvis here. How can I help?`
      : "Jarvis here. I'm afraid I don't recognise this number, but go ahead.";
    if (user) {
      this.emit(user.userId, "call_started", `Incoming call from ${user.name}`);
      this.emit(user.userId, "call_transcript", hello, { speaker: "jarvis" });
    }
    return conversationTwiML(hello, { voice: this.voice, actionUrl: this.turnUrl });
  }

  /** TwiML for a spoken turn during a call. */
  async turn(from: string, speech: string): Promise<string> {
    const user = this.byPhone.get(from);
    if (!user) {
      return conversationTwiML("I can't help an unrecognised caller. Goodbye.", {
        voice: this.voice,
      });
    }
    const text = speech.trim();
    if (!text) {
      return conversationTwiML("I didn't catch that. Could you say it again?", {
        voice: this.voice,
        actionUrl: this.turnUrl,
      });
    }
    this.emit(user.userId, "call_transcript", text, { speaker: "caller" });
    if (isGoodbye(text)) {
      this.emit(user.userId, "call_transcript", "Very good. Goodbye.", { speaker: "jarvis" });
      this.emit(user.userId, "call_ended", "Call ended");
      return conversationTwiML("Very good. Goodbye.", { voice: this.voice });
    }
    try {
      const cmd = parseCommand(text);
      let reply: string;
      if (cmd.kind === "approve") {
        reply = (await this.deps.gate.approve(cmd.id, user.userId)).message;
      } else if (cmd.kind === "reject") {
        await this.deps.gate.reject(cmd.id, user.userId);
        reply = "Rejected.";
      } else if (cmd.kind === "list") {
        const pending = await this.deps.gate.listPending(user.userId);
        reply = pending.length
          ? `You have ${pending.length} pending: ` +
            pending.map((p) => p.summary).join("; ")
          : "Nothing is pending.";
      } else {
        const out = await this.deps.brain.handle({
          userId: user.userId,
          surface: "voice",
          text: cmd.text,
        });
        reply = out.text;
      }
      this.emit(user.userId, "call_transcript", reply, { speaker: "jarvis" });
      return conversationTwiML(reply, { voice: this.voice, actionUrl: this.turnUrl });
    } catch (err) {
      logger.error("voice turn failed", err);
      return conversationTwiML(
        "Something went wrong on my end. Try again in a moment.",
        { voice: this.voice, actionUrl: this.turnUrl }
      );
    }
  }

  /** TwiML for an outbound announcement call — token was minted in send(). */
  announcementFor(token: string): string {
    const now = Date.now();
    const entry = this.announcements.get(token);
    this.announcements.delete(token);
    for (const [k, v] of this.announcements) if (v.expires < now) this.announcements.delete(k);
    const text =
      entry && entry.expires >= now
        ? entry.text
        : "Jarvis calling. That reminder has expired. Goodbye.";
    return announceTwiML(text, { voice: this.voice });
  }

  async start(): Promise<void> {
    logger.info("voice surface ready", { from: this.deps.fromNumber, users: this.byPhone.size });
  }
  async stop(): Promise<void> {}

  /** Proactive call: ring the user and speak the message. */
  async send(userId: string, text: string): Promise<void> {
    const user = this.byUserId.get(userId);
    if (!user) return;
    const token = randomUUID();
    this.announcements.set(token, {
      text: `${user.name}, this is Jarvis. ${text.slice(0, 600)}`,
      expires: Date.now() + 5 * 60_000,
    });
    await this.client.placeCall(user.phone, `${this.announceBase}?t=${token}`);
  }
}
