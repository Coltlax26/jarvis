import type { Db } from "../../db/index.js";
import type { MemoryRepo } from "../../memory/repo.js";
import type { ActionRegistry } from "../registry.js";
import { rememberAction } from "./remember.js";
import { setReminderAction } from "./setReminder.js";
import { sendTestMessageAction } from "./sendTestMessage.js";
import { spendTestAction } from "./spendTest.js";
import { placeCallAction, type PlaceOutbound } from "./placeCall.js";
import { registerGoogleActions, type GoogleActionsApi } from "./google.js";
import { browseAction, type BrowseApi } from "./browse.js";

export function registerBuiltins(
  reg: ActionRegistry,
  deps: {
    memory: MemoryRepo;
    db: Db;
    placeOutbound?: PlaceOutbound;
    google?: GoogleActionsApi;
    browse?: BrowseApi;
  }
): void {
  reg.register(rememberAction(deps.memory));
  reg.register(setReminderAction(deps.db));
  reg.register(sendTestMessageAction());
  reg.register(spendTestAction());
  reg.register(placeCallAction({ placeOutbound: deps.placeOutbound }));
  if (deps.google) registerGoogleActions(reg, deps.google);
  if (deps.browse) reg.register(browseAction(deps.browse));
}
