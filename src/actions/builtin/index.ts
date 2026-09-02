import type { Db } from "../../db/index.js";
import type { MemoryRepo } from "../../memory/repo.js";
import type { ActionRegistry } from "../registry.js";
import { rememberAction } from "./remember.js";
import { setReminderAction } from "./setReminder.js";
import { sendTestMessageAction } from "./sendTestMessage.js";
import { spendTestAction } from "./spendTest.js";
import { registerGoogleActions, type GoogleActionsApi } from "./google.js";
import { browseAction, type BrowseApi } from "./browse.js";
import { registerMacActions, type MacApi } from "./mac.js";
import { registerProspectActions } from "./prospects.js";
import type { ProspectRepo } from "../../prospects/repo.js";

export function registerBuiltins(
  reg: ActionRegistry,
  deps: {
    memory: MemoryRepo;
    db: Db;
    google?: GoogleActionsApi;
    browse?: BrowseApi;
    mac?: MacApi;
    prospects?: ProspectRepo;
  }
): void {
  reg.register(rememberAction(deps.memory));
  reg.register(setReminderAction(deps.db));
  reg.register(sendTestMessageAction());
  reg.register(spendTestAction());
  if (deps.google) registerGoogleActions(reg, deps.google);
  if (deps.browse) reg.register(browseAction(deps.browse));
  if (deps.mac) registerMacActions(reg, deps.mac);
  if (deps.prospects) registerProspectActions(reg, deps.prospects);
}
