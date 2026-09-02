import { randomUUID } from "node:crypto";
import { logger } from "../../logger.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { ActivityRepo } from "../../activity/repo.js";
import type { JarvisBus, JarvisEventKind } from "../../core/events.js";
import type { Surface } from "../types.js";
import { parseCommand } from "../telegram/parse.js";
import {
  TwilioVoiceClient,
  announceTwiML,
  conversationTwiML,
} from "../twilio/voiceClient.js";

type VoiceUser = {
  phone: string;
  userId: string;
  name: string;
  greeting: string | null;
  signoff: string | null;
};

/** Per-user voice settings resolved live (console overrides, else env default). */
export type VoiceResolved = {
  voice: string;
  greeting: string | null;
  signoff: string | null;
  speechTimeout: string;
};

const isGoodbye = (s: string): boolean =>
  /\b(good\s?bye|bye now|hang up|that'?s all|nothing else|talk later|we'?re done)\b/i.test(s);

const fillName = (tpl: string, name: string): string =>
  tpl.replace(/\{name\}/gi, name);

export class VoiceSurface implements Surface {
  readonly name = "voice";
  private client: TwilioVoiceClient;
  private byPhone: Map<string, VoiceUser>;
  private byUserId: Map<string, VoiceUser>;
  private defaultVoice: string;
  private defaultSpeechTimeout: string;
  private turnUrl: string;
  private incomingUrl: string;
  private announceBase: string;
  private announcements = new Map<string, { text: string; voice: string; expires: number }>();
  /** Per-call scratch state, keyed by Twilio CallSid. */
  private calls = new Map<string, { userId: string; empties: number; last: number }>();

  constructor(
    private deps: {
      accountSid: string;
      authToken: string;
      fromNumber: string;
      voice: string;
      speechTimeout?: string;
      publicUrl: string;
      users: VoiceUser[];
      brain: Brain;
      gate: ActionGate;
      bus?: JarvisBus;
      activity?: ActivityRepo;
      /** Live per-user overrides for voice/greeting/signoff/timeout. */
      resolve?: (userId: string, base: VoiceResolved) => Promise<VoiceResolved>;
    }
  ) {
    this.client = new TwilioVoiceClient({
      accountSid: deps.accountSid,
      authToken: deps.authToken,
      fromNumber: deps.fromNumber,
    });
    this.byPhone = new Map(deps.users.map((u) => [u.phone, u]));
    this.byUserId = new Map(deps.users.map((u) => [u.userId, u]));
    this.defaultVoice = deps.voice;
    this.defaultSpeechTimeout = deps.speechTimeout || "auto";
    const base = deps.publicUrl.replace(/\/$/, "");
    this.incomingUrl = `${base}/twilio/voice`;
    this.turnUrl = `${base}/twilio/voice/turn`;
    this.announceBase = `${base}/twilio/voice/announce`;
  }

  private async resolved(user: VoiceUser): Promise<VoiceResolved> {
    const base: VoiceResolved = {
      voice: this.defaultVoice,
      greeting: user.greeting,
      signoff: user.signoff,
      speechTimeout: this.defaultSpeechTimeout,
    };
    if (!this.deps.resolve) return base;
    try {
      return await this.deps.resolve(user.userId, base);
    } catch (err) {
      logger.error("voice settings resolve failed", err);
      return base;
    }
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

  private sweepCalls(): void {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [sid, c] of this.calls) if (c.last < cutoff) this.calls.delete(sid);
  }

  urls(): { incoming: string; turn: string; announce: string } {
    return { incoming: this.incomingUrl, turn: this.turnUrl, announce: this.announceBase };
  }

  userForPhone(from: string): VoiceUser | undefined {
    return this.byPhone.get(from);
  }

  activeCalls(): { userId: string; name: string; sinceMs: number }[] {
    this.sweepCalls();
    const now = Date.now();
    const out: { userId: string; name: string; sinceMs: number }[] = [];
    for (const c of this.calls.values()) {
      const u = this.byUserId.get(c.userId);
      out.push({ userId: c.userId, name: u?.name ?? c.userId, sinceMs: now - c.last });
    }
    return out;
  }

  /** conversationTwiML with a listening Gather. */
  private convo(text: string, voice: string, speechTimeout: string): string {
    return conversationTwiML(text, {
      voice,
      actionUrl: this.turnUrl,
      speechTimeout,
    });
  }

  /** TwiML for an inbound call. */
  async greeting(from: string, callSid: string): Promise<string> {
    this.sweepCalls();
    const user = this.byPhone.get(from);
    if (!user) {
      return conversationTwiML(
        "Jarvis here. I'm afraid I don't recognise this number. Goodbye.",
        { voice: this.defaultVoice }
      );
    }
    const r = await this.resolved(user);
    this.calls.set(callSid, { userId: user.userId, empties: 0, last: Date.now() });
    const hello = fillName(
      r.greeting ?? "Good day, {name}. Jarvis here. How can I help?",
      user.name
    );
    this.emit(user.userId, "call_started", `Incoming call from ${user.name}`);
    this.emit(user.userId, "call_transcript", hello, { speaker: "jarvis" });
    void this.deps.activity?.log({
      userId: user.userId,
      kind: "call_started",
      summary: `Call from ${user.name}`,
    });
    return this.convo(hello, r.voice, r.speechTimeout);
  }

  private endCall(user: VoiceUser, callSid: string, line: string, voice: string): string {
    this.calls.delete(callSid);
    this.emit(user.userId, "call_transcript", line, { speaker: "jarvis" });
    this.emit(user.userId, "call_ended", "Call ended");
    void this.deps.activity?.log({
      userId: user.userId,
      kind: "call_ended",
      summary: `Call with ${user.name} ended`,
    });
    return conversationTwiML(line, { voice });
  }

  /** TwiML for a spoken turn during a call. */
  async turn(from: string, speech: string, callSid: string): Promise<string> {
    const user = this.byPhone.get(from);
    if (!user) {
      return conversationTwiML("I can't help an unrecognised caller. Goodbye.", {
        voice: this.defaultVoice,
      });
    }
    const r = await this.resolved(user);
    const signoff = r.signoff ?? "Very good. Goodbye.";
    const state = this.calls.get(callSid) ?? {
      userId: user.userId,
      empties: 0,
      last: Date.now(),
    };
    this.calls.set(callSid, { ...state, last: Date.now() });

    const text = speech.trim();
    if (!text) {
      state.empties += 1;
      this.calls.set(callSid, { ...state, empties: state.empties, last: Date.now() });
      if (state.empties === 1) {
        return this.convo("Are you still there?", r.voice, r.speechTimeout);
      }
      return this.endCall(user, callSid, signoff, r.voice);
    }
    state.empties = 0;
    this.emit(user.userId, "call_transcript", text, { speaker: "caller" });
    if (isGoodbye(text)) {
      return this.endCall(user, callSid, signoff, r.voice);
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
      return this.convo(reply, r.voice, r.speechTimeout);
    } catch (err) {
      logger.error("voice turn failed", err);
      return this.convo(
        "Something went wrong on my end. Try again in a moment.",
        r.voice,
        r.speechTimeout
      );
    }
  }

  /** Twilio call status callback — fires when a call completes/fails. */
  callStatus(callSid: string, status: string): void {
    if (["completed", "busy", "failed", "no-answer", "canceled"].includes(status)) {
      const state = this.calls.get(callSid);
      this.calls.delete(callSid);
      if (state) {
        this.emit(state.userId, "call_ended", "Call ended");
        const u = this.byUserId.get(state.userId);
        void this.deps.activity?.log({
          userId: state.userId,
          kind: "call_ended",
          summary: `Call with ${u?.name ?? state.userId} ended`,
        });
      }
    }
  }

  /** TwiML for an outbound announcement call — token was minted in send(). */
  announcementFor(token: string): string {
    const now = Date.now();
    const entry = this.announcements.get(token);
    this.announcements.delete(token);
    for (const [k, v] of this.announcements) if (v.expires < now) this.announcements.delete(k);
    if (entry && entry.expires >= now) {
      return announceTwiML(entry.text, { voice: entry.voice });
    }
    return announceTwiML("Jarvis calling. That reminder has expired. Goodbye.", {
      voice: this.defaultVoice,
    });
  }

  async start(): Promise<void> {
    logger.info("voice surface ready", {
      from: this.deps.fromNumber,
      users: this.byPhone.size,
    });
  }
  async stop(): Promise<void> {}

  /** Proactive call: ring the user and speak the message. */
  async send(userId: string, text: string): Promise<void> {
    const user = this.byUserId.get(userId);
    if (!user) return;
    const r = await this.resolved(user);
    const token = randomUUID();
    this.announcements.set(token, {
      text: `${user.name}, this is Jarvis. ${text.slice(0, 600)}`,
      voice: r.voice,
      expires: Date.now() + 5 * 60_000,
    });
    await this.client.placeCall(user.phone, `${this.announceBase}?t=${token}`);
  }
}
