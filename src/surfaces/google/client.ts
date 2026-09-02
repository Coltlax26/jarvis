import { OAuth2Client } from "google-auth-library";
import { logger } from "../../logger.js";
import type { GoogleTokenRepo } from "./repo.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
];

export type InboxMessage = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  htmlLink: string | null;
};

/**
 * Google Gmail + Calendar for a single OAuth client (Gmail scope: modify,
 * Calendar scope: full). Tokens are per-user in `GoogleTokenRepo`; access
 * tokens are refreshed and re-persisted on demand.
 */
export class GoogleClient {
  constructor(
    private opts: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      tokens: GoogleTokenRepo;
    }
  ) {}

  private oauth(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.opts.clientId,
      clientSecret: this.opts.clientSecret,
      redirectUri: this.opts.redirectUri,
    });
  }

  authUrl(state: string): string {
    return this.oauth().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state,
    });
  }

  /** Exchange an authorization code and persist the tokens for `userId`. */
  async connect(userId: string, code: string): Promise<void> {
    const { tokens } = await this.oauth().getToken(code);
    if (!tokens.refresh_token) {
      // Google only returns a refresh token on first consent; force re-consent.
      throw new Error("Google did not return a refresh token — try connecting again.");
    }
    await this.opts.tokens.save(userId, {
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token,
      scope: tokens.scope ?? null,
      tokenType: tokens.token_type ?? null,
      expiryDate: tokens.expiry_date ?? null,
    });
  }

  async isConnected(userId: string): Promise<boolean> {
    return (await this.opts.tokens.get(userId)) != null;
  }

  async disconnect(userId: string): Promise<void> {
    await this.opts.tokens.delete(userId);
  }

  /** A valid access token for `userId`, refreshing + persisting if needed. */
  private async accessToken(userId: string): Promise<string> {
    const stored = await this.opts.tokens.get(userId);
    if (!stored) throw new NotConnectedError();
    const fresh =
      stored.accessToken &&
      stored.expiryDate &&
      stored.expiryDate - Date.now() > 60_000;
    if (fresh) return stored.accessToken!;

    const client = this.oauth();
    client.setCredentials({ refresh_token: stored.refreshToken });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) throw new Error("Google token refresh failed");
    await this.opts.tokens.save(userId, {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token ?? stored.refreshToken,
      scope: credentials.scope ?? stored.scope,
      tokenType: credentials.token_type ?? stored.tokenType,
      expiryDate: credentials.expiry_date ?? null,
    });
    return credentials.access_token;
  }

  private async api<T>(
    userId: string,
    url: string,
    init: RequestInit = {}
  ): Promise<T> {
    const token = await this.accessToken(userId);
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Google API ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  // ---- Gmail ----

  async recentInbox(userId: string, limit = 8): Promise<InboxMessage[]> {
    const list = await this.api<{ messages?: { id: string }[] }>(
      userId,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&labelIds=INBOX`
    );
    const ids = (list.messages ?? []).map((m) => m.id);
    const out: InboxMessage[] = [];
    for (const id of ids) {
      const msg = await this.api<{
        snippet?: string;
        payload?: { headers?: { name: string; value: string }[] };
        internalDate?: string;
      }>(
        userId,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`
      );
      const h = (n: string) =>
        msg.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
      out.push({
        id,
        from: h("From"),
        subject: h("Subject"),
        snippet: msg.snippet ?? "",
        date: msg.internalDate
          ? new Date(Number(msg.internalDate)).toISOString()
          : "",
      });
    }
    return out;
  }

  async createDraft(
    userId: string,
    input: { to: string; subject: string; body: string }
  ): Promise<{ id: string }> {
    const raw = Buffer.from(
      [
        `To: ${input.to}`,
        `Subject: ${input.subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        input.body,
      ].join("\r\n")
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const draft = await this.api<{ id: string }>(
      userId,
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      { method: "POST", body: JSON.stringify({ message: { raw } }) }
    );
    return { id: draft.id };
  }

  // ---- Calendar ----

  async listEvents(
    userId: string,
    range: { timeMin: string; timeMax: string; limit?: number }
  ): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(range.limit ?? 20),
    });
    const data = await this.api<{ items?: RawEvent[] }>(
      userId,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`
    );
    return (data.items ?? []).map(toEvent);
  }

  async createEvent(
    userId: string,
    input: { summary: string; start: string; end: string; location?: string; description?: string }
  ): Promise<CalendarEvent> {
    const ev = await this.api<RawEvent>(
      userId,
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        body: JSON.stringify({
          summary: input.summary,
          location: input.location,
          description: input.description,
          start: { dateTime: input.start },
          end: { dateTime: input.end },
        }),
      }
    );
    return toEvent(ev);
  }

  async updateEvent(
    userId: string,
    eventId: string,
    patch: { start?: string; end?: string; summary?: string }
  ): Promise<CalendarEvent> {
    const body: Record<string, unknown> = {};
    if (patch.summary) body.summary = patch.summary;
    if (patch.start) body.start = { dateTime: patch.start };
    if (patch.end) body.end = { dateTime: patch.end };
    const ev = await this.api<RawEvent>(
      userId,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );
    return toEvent(ev);
  }

  /** Best-effort: log and swallow, used by the calendar-reminder job. */
  async safeListEvents(
    userId: string,
    range: { timeMin: string; timeMax: string }
  ): Promise<CalendarEvent[]> {
    try {
      return await this.listEvents(userId, range);
    } catch (err) {
      logger.warn("calendar poll failed", { userId, err: (err as Error).message });
      return [];
    }
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super("Google account is not connected");
    this.name = "NotConnectedError";
  }
}

type RawEvent = {
  id: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function toEvent(e: RawEvent): CalendarEvent {
  return {
    id: e.id,
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    location: e.location ?? null,
    htmlLink: e.htmlLink ?? null,
  };
}
