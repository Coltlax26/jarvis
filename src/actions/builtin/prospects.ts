import { z } from "zod";
import type { Action } from "../types.js";
import type { ActionRegistry } from "../registry.js";
import { PROSPECT_STATUSES, type ProspectRepo } from "../../prospects/repo.js";

export function registerProspectActions(reg: ActionRegistry, repo: ProspectRepo): void {
  reg.register(saveProspectAction(repo));
  reg.register(listProspectsAction(repo));
  reg.register(setProspectStatusAction(repo));
}

export function saveProspectAction(
  repo: ProspectRepo
): Action<{
  name: string;
  businessType?: string;
  town?: string;
  phone?: string;
  website?: string;
  notes?: string;
}> {
  return {
    name: "save_prospect",
    tier: 0,
    description:
      "Add a business to Colt's sales pipeline (the Prospects tab). Use this for " +
      "every lead you find — one call per business. Re-adding the same name+town " +
      "is a no-op, so it's safe to call after a lead-gen run.",
    schema: z.object({
      name: z.string().min(1),
      businessType: z.string().optional(),
      town: z.string().optional(),
      phone: z.string().optional(),
      website: z.string().optional(),
      notes: z.string().optional(),
    }),
    summarize: (i) => `save prospect: ${i.name}${i.town ? ` (${i.town})` : ""}`,
    run: async (i, ctx) => {
      const p = await repo.add(ctx.userId, i);
      return { ok: true, message: `Saved ${p.name} to the pipeline (${p.status}).`, data: { id: p.id } };
    },
  };
}

export function listProspectsAction(
  repo: ProspectRepo
): Action<{ status?: (typeof PROSPECT_STATUSES)[number] }> {
  return {
    name: "list_prospects",
    tier: 0,
    description:
      "List Colt's sales pipeline. Optional status filter: " +
      PROSPECT_STATUSES.join(", ") +
      ". Use when he asks about his prospects, pipeline, or who to follow up with.",
    schema: z.object({ status: z.enum(PROSPECT_STATUSES).optional() }),
    summarize: (i) => `list prospects${i.status ? ` (${i.status})` : ""}`,
    run: async (i, ctx) => {
      const list = await repo.list(ctx.userId, i.status);
      if (!list.length) return { ok: true, message: "Pipeline is empty." };
      const lines = list.map(
        (p) =>
          `• [${p.status}] ${p.name}${p.businessType ? ` — ${p.businessType}` : ""}` +
          `${p.town ? `, ${p.town}` : ""}${p.phone ? ` · ${p.phone}` : ""}` +
          `${p.website ? ` · ${p.website}` : " · no website"}` +
          `  (id ${p.id.slice(0, 8)})`
      );
      return { ok: true, message: lines.join("\n"), data: list };
    },
  };
}

export function setProspectStatusAction(
  repo: ProspectRepo
): Action<{ id: string; status: (typeof PROSPECT_STATUSES)[number]; notes?: string }> {
  return {
    name: "set_prospect_status",
    tier: 0,
    description:
      "Move a prospect along the pipeline. `id` is from list_prospects (the 8-char " +
      "prefix is fine). status: " + PROSPECT_STATUSES.join(", ") + ".",
    schema: z.object({
      id: z.string().min(4),
      status: z.enum(PROSPECT_STATUSES),
      notes: z.string().optional(),
    }),
    summarize: (i) => `set prospect ${i.id} -> ${i.status}`,
    run: async (i, ctx) => {
      // Allow an 8-char prefix.
      let id = i.id;
      if (id.length < 20) {
        const all = await repo.list(ctx.userId);
        const hit = all.find((p) => p.id.startsWith(id));
        if (!hit) return { ok: false, message: `No prospect matching id ${i.id}.` };
        id = hit.id;
      }
      const patch: { status: (typeof PROSPECT_STATUSES)[number]; notes?: string } = {
        status: i.status,
      };
      if (i.notes) patch.notes = i.notes;
      const p = await repo.update(ctx.userId, id, patch);
      if (!p) return { ok: false, message: `No prospect matching id ${i.id}.` };
      return { ok: true, message: `${p.name} is now "${p.status}".` };
    },
  };
}
