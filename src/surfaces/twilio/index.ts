import { logger } from "../../logger.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { Surface } from "../types.js";
import { parseCommand } from "../telegram/parse.js";
import { TwilioClient } from "./client.js";

type SmsUser = { phone: string; userId: string };

export class TwilioSurface implements Surface {
  readonly name = "sms";
  private client: TwilioClient;
  private byPhone: Map<string, string>;
  private byUserId: Map<string, string>;

  constructor(
    private deps: {
      accountSid: string;
      authToken: string;
      fromNumber: string;
      users: SmsUser[];
      brain: Brain;
      gate: ActionGate;
    }
  ) {
    this.client = new TwilioClient({
      accountSid: deps.accountSid,
      authToken: deps.authToken,
      fromNumber: deps.fromNumber,
    });
    this.byPhone = new Map(deps.users.map((u) => [u.phone, u.userId]));
    this.byUserId = new Map(deps.users.map((u) => [u.userId, u.phone]));
  }

  /** Twilio webhook signature check, exposed for the HTTP route. */
  verify(signature: string | undefined, url: string, params: Record<string, string>): boolean {
    return this.client.verifySignature(signature, url, params);
  }

  userForPhone(from: string): string | undefined {
    return this.byPhone.get(from);
  }

  /**
   * Handle an inbound SMS. The HTTP route answers Twilio immediately with an
   * empty response; this runs async and sends the reply as a fresh message.
   */
  async handleInbound(fromPhone: string, text: string): Promise<void> {
    const userId = this.byPhone.get(fromPhone);
    if (!userId) {
      logger.warn("sms from unknown number", { fromPhone });
      return;
    }
    const cmd = parseCommand(text);
    try {
      if (cmd.kind === "list") {
        const pending = await this.deps.gate.listPending(userId);
        await this.send(
          userId,
          pending.length
            ? pending.map((p) => `${p.id.slice(0, 8)} [t${p.tier}] ${p.summary}`).join("\n")
            : "Nothing pending."
        );
        return;
      }
      if (cmd.kind === "approve" || cmd.kind === "reject") {
        if (cmd.kind === "approve") {
          const r = await this.deps.gate.approve(cmd.id, userId);
          await this.send(userId, r.message);
        } else {
          await this.deps.gate.reject(cmd.id, userId);
          await this.send(userId, "Rejected.");
        }
        return;
      }
      const out = await this.deps.brain.handle({ userId, surface: "sms", text: cmd.text });
      await this.send(userId, out.text);
    } catch (err) {
      logger.error("sms handler failed", err);
      await this.send(userId, `Something went wrong: ${(err as Error).message}`).catch(() => {});
    }
  }

  async start(): Promise<void> {
    logger.info("sms surface ready", { from: this.deps.fromNumber, users: this.byPhone.size });
  }
  async stop(): Promise<void> {}

  async send(userId: string, text: string): Promise<void> {
    const to = this.byUserId.get(userId);
    if (!to) return;
    await this.client.sendSms(to, text);
  }
}
