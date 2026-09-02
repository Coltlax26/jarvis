import { z } from "zod";
import type { Action } from "../types.js";
import type { ActionRegistry } from "../registry.js";
import type { InboxMessage, CalendarEvent } from "../../surfaces/google/client.js";

/** The slice of GoogleClient the actions need — kept structural for testing. */
export type GoogleActionsApi = {
  isConnected(userId: string): Promise<boolean>;
  recentInbox(userId: string, limit?: number): Promise<InboxMessage[]>;
  createDraft(
    userId: string,
    input: { to: string; subject: string; body: string }
  ): Promise<{ id: string }>;
  listEvents(
    userId: string,
    range: { timeMin: string; timeMax: string; limit?: number }
  ): Promise<CalendarEvent[]>;
  createEvent(
    userId: string,
    input: {
      summary: string;
      start: string;
      end: string;
      location?: string;
      description?: string;
    }
  ): Promise<CalendarEvent>;
  updateEvent(
    userId: string,
    eventId: string,
    patch: { start?: string; end?: string; summary?: string }
  ): Promise<CalendarEvent>;
};

const NOT_CONNECTED =
  "Your Google account isn't connected. Open the console → Settings → Connect Google.";

const iso = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 timestamp");

export function registerGoogleActions(
  reg: ActionRegistry,
  api: GoogleActionsApi
): void {
  reg.register(readInboxAction(api));
  reg.register(draftEmailAction(api));
  reg.register(listEventsAction(api));
  reg.register(addEventAction(api));
  reg.register(moveEventAction(api));
}

export function readInboxAction(api: GoogleActionsApi): Action<{ limit?: number }> {
  return {
    name: "read_inbox",
    tier: 0,
    description:
      "Read the most recent messages in Colt's Gmail inbox (sender, subject, snippet). " +
      "Use when he asks what's in his email or to summarise recent mail.",
    schema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
    summarize: (i) => `read inbox (${i.limit ?? 8})`,
    run: async (i, ctx) => {
      if (!(await api.isConnected(ctx.userId))) return { ok: false, message: NOT_CONNECTED };
      const msgs = await api.recentInbox(ctx.userId, i.limit ?? 8);
      if (!msgs.length) return { ok: true, message: "Inbox is empty." };
      const lines = msgs.map(
        (m) => `• ${m.from} — ${m.subject || "(no subject)"}: ${m.snippet}`
      );
      return { ok: true, message: lines.join("\n"), data: msgs };
    },
  };
}

export function draftEmailAction(
  api: GoogleActionsApi
): Action<{ to: string; subject: string; body: string }> {
  return {
    name: "draft_email",
    tier: 1,
    description:
      "Create a draft email in Colt's Gmail (not sent). He reviews and sends it himself. " +
      "Use when he asks you to write or reply to an email.",
    schema: z.object({
      to: z.string().min(3),
      subject: z.string().min(1),
      body: z.string().min(1),
    }),
    summarize: (i) => `draft email to ${i.to} — "${i.subject}"`,
    run: async (i, ctx) => {
      if (!(await api.isConnected(ctx.userId))) return { ok: false, message: NOT_CONNECTED };
      const { id } = await api.createDraft(ctx.userId, i);
      return { ok: true, message: `Draft saved to Gmail (id ${id}).`, data: { id } };
    },
  };
}

export function listEventsAction(
  api: GoogleActionsApi
): Action<{ fromIso?: string; toIso?: string }> {
  return {
    name: "list_events",
    tier: 0,
    description:
      "List calendar events in a time window (defaults to the next 7 days). " +
      "fromIso / toIso are ISO 8601 timestamps.",
    schema: z.object({ fromIso: iso.optional(), toIso: iso.optional() }),
    summarize: () => "list calendar events",
    run: async (i, ctx) => {
      if (!(await api.isConnected(ctx.userId))) return { ok: false, message: NOT_CONNECTED };
      const timeMin = i.fromIso ?? new Date().toISOString();
      const timeMax =
        i.toIso ?? new Date(Date.now() + 7 * 86_400_000).toISOString();
      const events = await api.listEvents(ctx.userId, { timeMin, timeMax });
      if (!events.length) return { ok: true, message: "Nothing on the calendar in that window." };
      const lines = events.map(
        (e) => `• ${e.start ?? "?"} — ${e.summary}${e.location ? ` @ ${e.location}` : ""}`
      );
      return { ok: true, message: lines.join("\n"), data: events };
    },
  };
}

export function addEventAction(
  api: GoogleActionsApi
): Action<{
  summary: string;
  startIso: string;
  endIso: string;
  location?: string;
  description?: string;
}> {
  return {
    name: "add_event",
    tier: 1,
    description:
      "Add an event to Colt's calendar. startIso / endIso are ISO 8601 timestamps. " +
      "Held for his approval before it is created.",
    schema: z.object({
      summary: z.string().min(1),
      startIso: iso,
      endIso: iso,
      location: z.string().optional(),
      description: z.string().optional(),
    }),
    summarize: (i) => `add "${i.summary}" @ ${i.startIso}`,
    run: async (i, ctx) => {
      if (!(await api.isConnected(ctx.userId))) return { ok: false, message: NOT_CONNECTED };
      const ev = await api.createEvent(ctx.userId, {
        summary: i.summary,
        start: i.startIso,
        end: i.endIso,
        location: i.location,
        description: i.description,
      });
      return { ok: true, message: `Added "${ev.summary}" to your calendar.`, data: ev };
    },
  };
}

export function moveEventAction(
  api: GoogleActionsApi
): Action<{ eventId: string; startIso: string; endIso: string }> {
  return {
    name: "move_event",
    tier: 1,
    description:
      "Reschedule an existing calendar event (get its eventId from list_events first). " +
      "startIso / endIso are the new ISO 8601 start and end. Held for approval.",
    schema: z.object({ eventId: z.string().min(1), startIso: iso, endIso: iso }),
    summarize: (i) => `move event ${i.eventId} to ${i.startIso}`,
    run: async (i, ctx) => {
      if (!(await api.isConnected(ctx.userId))) return { ok: false, message: NOT_CONNECTED };
      const ev = await api.updateEvent(ctx.userId, i.eventId, {
        start: i.startIso,
        end: i.endIso,
      });
      return { ok: true, message: `Moved "${ev.summary}" to ${ev.start}.`, data: ev };
    },
  };
}
