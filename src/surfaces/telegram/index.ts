import { Bot } from "grammy";
import { logger } from "../../logger.js";
import type { Brain } from "../../core/brain.js";
import type { ActionGate } from "../../actions/gate.js";
import type { Surface } from "../types.js";
import { parseCommand } from "./parse.js";

export class TelegramSurface implements Surface {
  readonly name = "telegram";
  private bot: Bot;

  constructor(
    private deps: {
      token: string;
      ownerId: string;
      userId: string;
      brain: Brain;
      gate: ActionGate;
    }
  ) {
    this.bot = new Bot(deps.token);
    this.bot.on("message:text", async (ctx) => {
      if (String(ctx.chat.id) !== this.deps.ownerId) {
        await ctx.reply("This assistant is private.");
        return;
      }
      const cmd = parseCommand(ctx.message.text);
      try {
        if (cmd.kind === "list") {
          const pending = await this.deps.gate.listPending(this.deps.userId);
          await ctx.reply(
            pending.length
              ? pending.map((p) => `${p.id} — [tier ${p.tier}] ${p.summary}`).join("\n")
              : "Nothing pending."
          );
          return;
        }
        if (cmd.kind === "approve" || cmd.kind === "reject") {
          if (cmd.kind === "approve") {
            const r = await this.deps.gate.approve(cmd.id, this.deps.userId);
            await ctx.reply(r.message);
          } else {
            await this.deps.gate.reject(cmd.id, this.deps.userId);
            await ctx.reply("Rejected.");
          }
          return;
        }
        const out = await this.deps.brain.handle({
          userId: this.deps.userId,
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

  async start(): Promise<void> {
    // start() resolves when polling stops; run it detached.
    void this.bot.start({ onStart: () => logger.info("telegram polling started") });
  }
  async stop(): Promise<void> {
    await this.bot.stop();
  }
  async send(_userId: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(this.deps.ownerId, text);
  }
}
