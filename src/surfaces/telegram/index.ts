import { Bot, GrammyError } from "grammy";
import { logger } from "../../logger.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { Surface } from "../types.js";
import { parseCommand } from "./parse.js";

type TgUser = { telegramId: string; userId: string };

export class TelegramSurface implements Surface {
  readonly name = "telegram";
  private bot: Bot;
  private byTelegramId: Map<string, string>;
  private byUserId: Map<string, string>;

  constructor(
    private deps: { token: string; brain: Brain; gate: ActionGate; users: TgUser[] }
  ) {
    this.byTelegramId = new Map(deps.users.map((u) => [u.telegramId, u.userId]));
    this.byUserId = new Map(deps.users.map((u) => [u.userId, u.telegramId]));
    this.bot = new Bot(deps.token);
    // A handler error must never bubble out of the polling loop and crash us.
    this.bot.catch((err) => logger.error("telegram bot error", err.error));
    this.bot.on("message:text", async (ctx) => {
      const userId = this.byTelegramId.get(String(ctx.chat.id));
      if (!userId) {
        await ctx.reply("This assistant is private.");
        return;
      }
      const cmd = parseCommand(ctx.message.text);
      try {
        if (cmd.kind === "list") {
          const pending = await this.deps.gate.listPending(userId);
          await ctx.reply(
            pending.length
              ? pending.map((p) => `${p.id} — [tier ${p.tier}] ${p.summary}`).join("\n")
              : "Nothing pending."
          );
          return;
        }
        if (cmd.kind === "approve" || cmd.kind === "reject") {
          if (cmd.kind === "approve") {
            const r = await this.deps.gate.approve(cmd.id, userId);
            await ctx.reply(r.message);
          } else {
            await this.deps.gate.reject(cmd.id, userId);
            await ctx.reply("Rejected.");
          }
          return;
        }
        const out = await this.deps.brain.handle({
          userId,
          surface: "telegram",
          text: cmd.text,
        });
        await ctx.reply(out.text);
      } catch (err) {
        logger.error("telegram handler failed", err);
        await ctx.reply(`Something went wrong: ${(err as Error).message}`);
      }
    });
  }

  private stopping = false;

  async start(): Promise<void> {
    // start() resolves only when polling stops; run it detached and keep it
    // alive across transient polling failures. The most common one is a 409
    // during a rolling deploy, when the previous instance still holds the
    // long-poll for a few seconds — retry rather than crash the process.
    void this.runPolling();
  }

  private async runPolling(attempt = 0): Promise<void> {
    if (this.stopping) return;
    try {
      await this.bot.start({
        onStart: () => logger.info("telegram polling started"),
      });
    } catch (err) {
      if (this.stopping) return;
      const is409 = err instanceof GrammyError && err.error_code === 409;
      const delayMs = Math.min(30_000, 3_000 * 2 ** attempt);
      logger.warn("telegram polling stopped; retrying", {
        conflict: is409,
        attempt,
        delayMs,
        err: (err as Error).message,
      });
      await new Promise((r) => setTimeout(r, delayMs));
      void this.runPolling(attempt + 1);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.bot.stop();
  }
  async send(userId: string, text: string): Promise<void> {
    const chatId = this.byUserId.get(userId);
    if (!chatId) return;
    await this.bot.api.sendMessage(chatId, text);
  }
}
