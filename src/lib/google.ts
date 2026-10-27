import "server-only";
import { JWT } from "google-auth-library";
import type { Interval } from "./core";

/**
 * google.ts - Google Calendar (and optionally Gmail) through ONE service account that acts as
 * each host in turn via Google Workspace domain-wide delegation.
 *
 * Needs, once, in the Workspace admin console (Security > Access and data control > API controls
 * > Domain-wide delegation): the service account's client ID with the calendar scope below (and
 * gmail.send if you turn on host emails). Until then every call fails with
 * `calendar_not_authorized` and the admin page says so.
 *
 * Acting as the host means: their calendar list is what they see, free/busy covers any calendar
 * shared with them (a personal Gmail calendar shared with "See only free/busy" counts), and the
 * booking is created on their calendar with them as organizer, so Google sends the guest the
 * invite, the Meet link, updates and cancellations. No email code needed for guests.
 *
 * ENV: GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY.
 */

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const API = "https://www.googleapis.com/calendar/v3";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TIMEOUT_MS = 12_000;

export function calendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SA_CLIENT_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY);
}

/**
 * Accept the private key however it was pasted: with literal "\n", wrapped in quotes, or with
 * its newlines eaten by a dashboard. Rebuilds clean 64-column PEM.
 */
export function normalizePrivateKey(raw: string | undefined | null): string {
  let k = String(raw ?? "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  k = k.replace(/\\n/g, "\n").replace(/\r/g, "").trim();
  const m = k.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return k;
  const label = m[1];
  const body = m[2].replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

const clients = new Map<string, JWT>();

function client(subject: string, scope: string): JWT {
  if (!calendarConfigured()) throw new Error("calendar_not_configured");
  const key = `${scope} ${subject}`;
  let c = clients.get(key);
  if (!c) {
    c = new JWT({
      email: process.env.GOOGLE_SA_CLIENT_EMAIL,
      key: normalizePrivateKey(process.env.GOOGLE_SA_PRIVATE_KEY),
      scopes: [scope],
      subject,
    });
    clients.set(key, c);
  }
  return c;
}

async function token(subject: string, scope = CALENDAR_SCOPE): Promise<string> {
  try {
    const { token: t } = await client(subject, scope).getAccessToken();
    if (!t) throw new Error("no token");
    return t;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // unauthorized_client = the scope is not on the delegation entry; invalid_grant = not a
    // user of this Workspace (or suspended).
    if (/unauthorized_client/i.test(msg)) throw new Error("calendar_not_authorized");
    if (/invalid_grant/i.test(msg)) throw new Error("calendar_user_unknown");
    if (msg === "calendar_not_configured") throw e;
    console.error("[google] token", msg.slice(0, 300));
    throw new Error("calendar_token_failed");
  }
}

async function gcal<T>(subject: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await token(subject)}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 204) return undefined as T;
  const body = await res.text();
  if (!res.ok) {
    console.error(`[google] ${init.method ?? "GET"} ${path.split("?")[0]} -> ${res.status}`, body.slice(0, 300));
    if (res.status === 404 || res.status === 410) throw new Error("calendar_event_gone");
    throw new Error("calendar_request_failed");
  }
  return (body ? JSON.parse(body) : undefined) as T;
}

/* ── Calendars ────────────────────────────────────────────────────────────────────── */

export type CalendarInfo = { id: string; summary: string; primary: boolean; accessRole: string; timeZone: string | null };

/** Every calendar the host has in their list (their own, shared, subscribed). */
export async function listCalendars(subject: string): Promise<CalendarInfo[]> {
  const out: CalendarInfo[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ maxResults: "250", minAccessRole: "freeBusyReader" });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await gcal<{ items?: Record<string, unknown>[]; nextPageToken?: string }>(subject, `/users/me/calendarList?${q}`);
    for (const c of r.items ?? []) {
      out.push({
        id: String(c.id),
        summary: String(c.summaryOverride ?? c.summary ?? c.id),
        primary: c.primary === true,
        accessRole: String(c.accessRole ?? ""),
        timeZone: typeof c.timeZone === "string" ? c.timeZone : null,
      });
    }
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export type FreeBusy = { busy: Interval[]; errors: Record<string, string> };

/**
 * Busy time across `ids` between two instants, as the host sees it. A calendar the host cannot
 * read comes back in `errors` (notFound / forbidden) and adds no busy time, so the admin page
 * can flag it.
 */
export async function freeBusy(subject: string, ids: string[], from: number, to: number): Promise<FreeBusy> {
  const items = [...new Set(ids.length ? ids : [subject])].slice(0, 50).map((id) => ({ id }));
  const r = await gcal<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> }>(
    subject,
    "/freeBusy",
    { method: "POST", body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items }) },
  );
  const busy: Interval[] = [];
  const errors: Record<string, string> = {};
  for (const [id, c] of Object.entries(r.calendars ?? {})) {
    if (c.errors?.length) errors[id] = c.errors[0]?.reason ?? "error";
    for (const b of c.busy ?? []) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
  }
  return { busy, errors };
}

/* ── Events ───────────────────────────────────────────────────────────────────────── */

export type EventInput = {
  calendarId: string;
  summary: string;
  description: string;
  start: number;
  end: number;
  attendees: { email: string; displayName?: string }[];
  bookingId: string;
  sourceUrl: string;
  /** Google Calendar event colour, "1".."11" (calendar_color on the event type). */
  colorId?: string | null;
};

export type CreatedEvent = { id: string; meetUrl: string | null; htmlLink: string | null };

function meetOf(e: Record<string, unknown>): string | null {
  if (typeof e.hangoutLink === "string") return e.hangoutLink;
  const eps = (e.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined)?.entryPoints ?? [];
  return eps.find((p) => p.entryPointType === "video")?.uri ?? null;
}

/** Create the meeting on the host's calendar with a Meet link and invite the guest. */
export async function insertEvent(subject: string, e: EventInput): Promise<CreatedEvent> {
  const q = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: "all" });
  const r = await gcal<Record<string, unknown>>(subject, `/calendars/${encodeURIComponent(e.calendarId)}/events?${q}`, {
    method: "POST",
    body: JSON.stringify({
      summary: e.summary,
      description: e.description,
      start: { dateTime: new Date(e.start).toISOString() },
      end: { dateTime: new Date(e.end).toISOString() },
      attendees: e.attendees,
      guestsCanModify: false,
      ...(e.colorId ? { colorId: e.colorId } : {}),
      reminders: { useDefault: true },
      conferenceData: { createRequest: { requestId: `cal-${e.bookingId}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
      extendedProperties: { private: { cal_booking_id: e.bookingId } },
      source: { title: "open-cal", url: e.sourceUrl },
    }),
  });
  return { id: String(r.id), meetUrl: meetOf(r), htmlLink: typeof r.htmlLink === "string" ? r.htmlLink : null };
}

export type EventState = { start: number; end: number };

/**
 * Where the meeting stands in Google now: null when it was deleted or cancelled there (by hand,
 * from the calendar), so the booking behind it is no longer real.
 */
export async function getEvent(subject: string, calendarId: string, eventId: string): Promise<EventState | null> {
  try {
    const e = await gcal<{ status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }>(
      subject,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
    if (e.status === "cancelled") return null;
    const start = Date.parse(e.start?.dateTime ?? "");
    const end = Date.parse(e.end?.dateTime ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  } catch (err) {
    if ((err as Error).message === "calendar_event_gone") return null;
    throw err;
  }
}

/** Move the meeting; Google tells every guest. */
export async function moveEvent(subject: string, calendarId: string, eventId: string, start: number, end: number): Promise<void> {
  await gcal(subject, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "PATCH",
    body: JSON.stringify({ start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() } }),
  });
}

/** Cancel the meeting; Google sends the cancellation. A meeting already gone counts as done. */
export async function deleteEvent(subject: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await gcal(subject, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
  } catch (e) {
    if ((e as Error).message !== "calendar_event_gone") throw e;
  }
}

/* ── Gmail (optional host notifications) ──────────────────────────────────────────── */

export type MailInput = { from: string; fromName?: string; to: string[]; replyTo?: string; subject: string; text: string; html?: string };

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
/** Header values never carry a line break (header injection). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** An RFC 2822 message: plain text, plus an HTML twin when given. Exported for the unit test. */
export function buildMime(m: MailInput): string {
  const from = m.fromName ? `${encodeHeader(oneLine(m.fromName))} <${oneLine(m.from)}>` : oneLine(m.from);
  const head = [
    `From: ${from}`,
    `To: ${m.to.map(oneLine).join(", ")}`,
    ...(m.replyTo ? [`Reply-To: ${oneLine(m.replyTo)}`] : []),
    `Subject: ${encodeHeader(oneLine(m.subject))}`,
    "MIME-Version: 1.0",
  ];
  if (!m.html) return [...head, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(m.text), ""].join("\r\n");
  const alt = `alt_${Math.random().toString(36).slice(2)}`;
  return [
    ...head,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.text),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.html),
    `--${alt}--`,
    "",
  ].join("\r\n");
}

/** Send as `m.from` (a Workspace user) through the Gmail API. Needs the gmail.send scope. */
export async function sendMail(m: MailInput): Promise<void> {
  const raw = Buffer.from(buildMime(m), "utf8").toString("base64url");
  const res = await fetch(GMAIL_SEND, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token(m.from, GMAIL_SCOPE)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gmail_${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
}
