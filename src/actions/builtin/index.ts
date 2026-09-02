import type { Db } from "../../db/index.js";
import type { MemoryRepo } from "../../memory/repo.js";
import type { ActionRegistry } from "../registry.js";
import { rememberAction } from "./remember.js";
import { setReminderAction } from "./setReminder.js";
import { sendTestMessageAction } from "./sendTestMessage.js";
import { spendTestAction } from "./spendTest.js";
import { placeCallAction, type PlaceOutbound } from "./placeCall.js";

export function registerBuiltins(
  reg: ActionRegistry,
  deps: { memory: MemoryRepo; db: Db; placeOutbound?: PlaceOutbound }
): void {
  reg.register(rememberAction(deps.memory));
  reg.register(setReminderAction(deps.db));
  reg.register(sendTestMessageAction());
  reg.register(spendTestAction());
  reg.register(placeCallAction({ placeOutbound: deps.placeOutbound }));
}
