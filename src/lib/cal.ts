import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays,
  generateSlots,
  localDate,
  manageUrl,
  siteUrl,
  withoutInterval,
  zonedToUtc,
  type DateOverrides,
  type Interval,
  type Question,
  type BookingForm,
  type Slot,
  type SlotRules,
  type WeeklyHours,
} from "./core";
import { deleteEvent, freeBusy, insertEvent, moveEvent, sendMail } from "./google";

/**
 * cal.ts - open-cal's data access and booking flow. Service-role only: the public booking
 * routes (/api/public/*) and the admin routes (/api/admin/*) both come through here.
 *
 * Booking is check-then-insert-then-Google:
 *   1. re-check the slot against live free/busy (never trust the page's copy),
 *   2. insert the row; the partial unique index on (host_id, start_at) turns a race into
 *      `slot_taken`,
 *   3. create the Google event as the host (Meet link, guest invited by Google). If Google
 *      fails the row is deleted again, so a booking row always has a meeting behind it.
 */

export type CalHost = {
  id: string;
  email: string;
  slug: string;
  name: string;
  headline: string | null;
  avatar_url: string | null;
  timezone: string;
  weekly_hours: WeeklyHours;
  date_overrides: DateOverrides;
  busy_calendar_ids: string[];
  target_calendar_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CalEventType = SlotRules & {
  id: string;
  host_id: string;
  slug: string;
  name: string;
  description: string | null;
  questions: Question[];
  extra_attendees: string[];
  color: string | null;
  position: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CalBooking = {
  id: string;
  host_id: string;
  event_type_id: string | null;
  event_name: string;
  start_at: string;
  end_at: string;
  status: "confirmed" | "cancelled";
  guest_name: string;
  guest_email: string;
  guest_timezone: string | null;
  answers: Record<string, string>;
  meta: Record<string, string>;
  manage_token: string;
  google_event_id: string | null;
  meet_url: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  rescheduled_from: string | null;
  created_at: string;
};

/** The fields a guest-facing page may see of a host (no email, no calendar ids). */
export type PublicHost = Pick<CalHost, "slug" | "name" | "headline" | "avatar_url" | "timezone">;
export type PublicEventType = Pick<CalEventType, "slug" | "name" | "description" | "duration_min" | "questions" | "color" | "max_days_ahead">;

export const publicHost = (h: CalHost): PublicHost => ({ slug: h.slug, name: h.name, headline: h.headline, avatar_url: h.avatar_url, timezone: h.timezone });
export const publicType = (t: CalEventType): PublicEventType => ({
  slug: t.slug,
  name: t.name,
  description: t.description,
  duration_min: t.duration_min,
  questions: t.questions,
  color: t.color,
  max_days_ahead: t.max_days_ahead,
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Bookings one network may make per hour before the page says try later. */
const BOOKINGS_PER_IP_HOUR = 5;

/* ── Reads ────────────────────────────────────────────────────────────────────────── */

function must<T>(r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export async function hostBySlug(svc: SupabaseClient, slug: string): Promise<CalHost | null> {
  return must(await svc.from("cal_hosts").select("*").eq("slug", slug).maybeSingle()) as CalHost | null;
}

export async function hostByEmail(svc: SupabaseClient, email: string): Promise<CalHost | null> {
  return must(await svc.from("cal_hosts").select("*").eq("email", email.toLowerCase()).maybeSingle()) as CalHost | null;
}

export async function hostById(svc: SupabaseClient, id: string): Promise<CalHost | null> {
  return must(await svc.from("cal_hosts").select("*").eq("id", id).maybeSingle()) as CalHost | null;
}

export async function listHosts(svc: SupabaseClient): Promise<CalHost[]> {
  return must(await svc.from("cal_hosts").select("*").order("name")) as CalHost[];
}

export async function eventTypes(svc: SupabaseClient, hostId: string, opts: { activeOnly?: boolean } = {}): Promise<CalEventType[]> {
  let q = svc.from("cal_event_types").select("*").eq("host_id", hostId);
  if (opts.activeOnly) q = q.eq("active", true);
  return must(await q.order("position").order("created_at")) as CalEventType[];
}

export async function eventType(svc: SupabaseClient, hostId: string, slug: string): Promise<CalEventType | null> {
  return must(await svc.from("cal_event_types").select("*").eq("host_id", hostId).eq("slug", slug).maybeSingle()) as CalEventType | null;
}

export async function bookingByToken(svc: SupabaseClient, token: string): Promise<CalBooking | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return must(await svc.from("cal_bookings").select("*").eq("manage_token", token).maybeSingle()) as CalBooking | null;
}

export async function bookingById(svc: SupabaseClient, id: string): Promise<CalBooking | null> {
  return must(await svc.from("cal_bookings").select("*").eq("id", id).maybeSingle()) as CalBooking | null;
}

/** Bookings for some hosts from `since` on (newest last), capped. */
export async function listBookings(svc: SupabaseClient, hostIds: string[], since: number, limit = 500): Promise<CalBooking[]> {
  if (!hostIds.length) return [];
  return must(
    await svc
      .from("cal_bookings")
      .select("*")
      .in("host_id", hostIds)
      .gte("start_at", new Date(since).toISOString())
      .order("start_at")
      .limit(limit),
  ) as CalBooking[];
}

/* ── Availability ─────────────────────────────────────────────────────────────────── */

export type Availability = { slots: Slot[]; unreadable: string[] };

/**
 * Open slots for one event type between two host-local dates. Free/busy is read for the whole
 * span plus a day each side (buffers can reach over midnight). `exclude` lifts one interval out
 * of the busy time: the booking being rescheduled.
 */
export async function availability(
  svc: SupabaseClient,
  host: CalHost,
  type: CalEventType,
  fromDate: string,
  toDate: string,
  opts: { now?: number; exclude?: Interval } = {},
): Promise<Availability> {
  const now = opts.now ?? Date.now();
  const from = zonedToUtc(fromDate, "00:00", host.timezone) - DAY;
  const to = zonedToUtc(addDays(toDate, 1), "00:00", host.timezone) + DAY;
  const calendars = host.busy_calendar_ids.length ? host.busy_calendar_ids : [host.email];
  const fb = await freeBusy(host.email, calendars, Math.max(from, now - DAY), to);
  const busy = opts.exclude ? withoutInterval(fb.busy, opts.exclude) : fb.busy;

  let bookedPerDay: Record<string, number> | undefined;
  if (type.max_per_day != null) {
    const rows = must(
      await svc
        .from("cal_bookings")
        .select("start_at")
        .eq("event_type_id", type.id)
        .eq("status", "confirmed")
        .gte("start_at", new Date(from).toISOString())
        .lt("start_at", new Date(to).toISOString()),
    ) as { start_at: string }[];
    bookedPerDay = {};
    for (const r of rows) {
      const t = Date.parse(r.start_at);
      if (opts.exclude && t === opts.exclude.start) continue;
      const d = localDate(t, host.timezone);
      bookedPerDay[d] = (bookedPerDay[d] ?? 0) + 1;
    }
  }

  const slots = generateSlots({
    timezone: host.timezone,
    weekly: host.weekly_hours ?? {},
    overrides: host.date_overrides ?? {},
    rules: type,
    busy,
    bookedPerDay,
    now,
    fromDate,
    toDate,
  });
  return { slots, unreadable: Object.keys(fb.errors) };
}

async function slotIsOpen(svc: SupabaseClient, host: CalHost, type: CalEventType, start: number, exclude?: Interval): Promise<boolean> {
  const date = localDate(start, host.timezone);
  const { slots } = await availability(svc, host, type, date, date, { exclude });
  return slots.some((s) => s.start === start);
}

/* ── Booking ──────────────────────────────────────────────────────────────────────── */

/** A keyed hash of the guest's IP, for the per-network rate limit. The raw IP is never stored. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT || process.env.ADMIN_PASSWORD || "open-cal";
  return createHmac("sha256", salt).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

/** The first address in x-forwarded-for (Vercel sets it), else x-real-ip. */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || null;
  return req.headers.get("x-real-ip");
}

const newToken = () => randomBytes(24).toString("base64url");

function describe(host: CalHost, type: CalEventType, form: BookingForm, token: string): string {
  const lines = [`${type.name} with ${host.name}.`, ""];
  for (const q of type.questions) {
    const a = form.answers[q.id];
    if (a) lines.push(`${q.label}`, a, "");
  }
  lines.push(`Need to reschedule or cancel? ${manageUrl(token)}`);
  return lines.join("\n");
}

export type BookInput = {
  host: CalHost;
  type: CalEventType;
  start: number;
  form: BookingForm;
  guestTimezone: string | null;
  meta: Record<string, string>;
  ipHash: string | null;
};

export async function book(svc: SupabaseClient, input: BookInput): Promise<CalBooking> {
  const { host, type, start, form } = input;
  if (!host.active || !type.active) throw new Error("not_found");

  if (input.ipHash) {
    const { count } = await svc
      .from("cal_bookings")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", input.ipHash)
      .gte("created_at", new Date(Date.now() - HOUR).toISOString());
    if ((count ?? 0) >= BOOKINGS_PER_IP_HOUR) throw new Error("too_many_bookings");
  }

  if (!(await slotIsOpen(svc, host, type, start))) throw new Error("slot_taken");

  const end = start + type.duration_min * 60_000;
  const token = newToken();
  const ins = await svc
    .from("cal_bookings")
    .insert({
      host_id: host.id,
      event_type_id: type.id,
      event_name: type.name,
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      guest_name: form.name,
      guest_email: form.email,
      guest_timezone: input.guestTimezone,
      answers: form.answers,
      meta: form.guests.length ? { ...input.meta, guests: form.guests.join(", ") } : input.meta,
      manage_token: token,
      ip_hash: input.ipHash,
    })
    .select("*")
    .single();
  if (ins.error) {
    if (ins.error.code === "23505") throw new Error("slot_taken");
    throw new Error(ins.error.message);
  }
  const row = ins.data as CalBooking;

  const attendees = [
    { email: form.email, displayName: form.name },
    ...[...new Set([...form.guests, ...type.extra_attendees.map((e) => e.toLowerCase())])].filter((e) => e && e !== host.email && e !== form.email).map((email) => ({ email })),
  ];
  try {
    const ev = await insertEvent(host.email, {
      calendarId: host.target_calendar_id || host.email,
      summary: `${form.name} x ${host.name} - ${type.name}`,
      description: describe(host, type, form, token),
      start,
      end,
      attendees,
      bookingId: row.id,
      sourceUrl: siteUrl(),
    });
    const upd = await svc.from("cal_bookings").update({ google_event_id: ev.id, meet_url: ev.meetUrl }).eq("id", row.id).select("*").single();
    after(notifyHost(host, type, { ...row, meet_url: ev.meetUrl }, "new"));
    return (upd.data as CalBooking) ?? { ...row, google_event_id: ev.id, meet_url: ev.meetUrl };
  } catch (e) {
    await svc.from("cal_bookings").delete().eq("id", row.id);
    throw e;
  }
}

export async function cancel(svc: SupabaseClient, booking: CalBooking, by: string, reason: string | null): Promise<CalBooking> {
  if (booking.status === "cancelled") return booking;
  const host = await hostById(svc, booking.host_id);
  if (!host) throw new Error("not_found");
  if (booking.google_event_id) await deleteEvent(host.email, host.target_calendar_id || host.email, booking.google_event_id);
  const r = await svc
    .from("cal_bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: by, cancel_reason: reason?.slice(0, 1000) || null, updated_at: new Date().toISOString() })
    .eq("id", booking.id)
    .select("*")
    .single();
  const row = must(r) as CalBooking;
  if (by === "guest") {
    const type = booking.event_type_id ? ((must(await svc.from("cal_event_types").select("*").eq("id", booking.event_type_id).maybeSingle()) as CalEventType | null) ?? null) : null;
    after(notifyHost(host, type, row, "cancelled"));
  }
  return row;
}

export async function reschedule(svc: SupabaseClient, booking: CalBooking, start: number): Promise<CalBooking> {
  if (booking.status !== "confirmed") throw new Error("booking_cancelled");
  if (Date.parse(booking.start_at) < Date.now()) throw new Error("booking_past");
  const host = await hostById(svc, booking.host_id);
  const type = booking.event_type_id
    ? ((must(await svc.from("cal_event_types").select("*").eq("id", booking.event_type_id).maybeSingle()) as CalEventType | null) ?? null)
    : null;
  if (!host || !type) throw new Error("not_found");
  const current = { start: Date.parse(booking.start_at), end: Date.parse(booking.end_at) };
  if (start === current.start) return booking;
  if (!(await slotIsOpen(svc, host, type, start, current))) throw new Error("slot_taken");

  const end = start + type.duration_min * 60_000;
  const upd = await svc
    .from("cal_bookings")
    .update({ start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(), rescheduled_from: booking.start_at, updated_at: new Date().toISOString() })
    .eq("id", booking.id)
    .select("*")
    .single();
  if (upd.error) {
    if (upd.error.code === "23505") throw new Error("slot_taken");
    throw new Error(upd.error.message);
  }
  try {
    if (booking.google_event_id) await moveEvent(host.email, host.target_calendar_id || host.email, booking.google_event_id, start, end);
  } catch (e) {
    await svc.from("cal_bookings").update({ start_at: booking.start_at, end_at: booking.end_at, rescheduled_from: booking.rescheduled_from }).eq("id", booking.id);
    throw e;
  }
  const row = upd.data as CalBooking;
  after(notifyHost(host, type, row, "moved"));
  return row;
}

/* ── Host email ───────────────────────────────────────────────────────────────────── */

/**
 * A short note to the host (Google already put the meeting on their calendar, but not with the
 * guest's answers in front of them). Off unless HOST_EMAILS=gmail; then it is sent from the
 * host's own mailbox to itself through the Gmail API (needs the gmail.send scope on the
 * delegation entry). Reply goes to the guest. Never throws: a booking stands either way.
 */
async function notifyHost(host: CalHost, type: CalEventType | null, b: CalBooking, kind: "new" | "moved" | "cancelled"): Promise<void> {
  if (process.env.HOST_EMAILS !== "gmail") return;
  try {
    const when = new Intl.DateTimeFormat("en-GB", { timeZone: host.timezone, dateStyle: "full", timeStyle: "short" }).format(new Date(b.start_at));
    const head = kind === "new" ? "New booking" : kind === "moved" ? "Booking moved" : "Booking cancelled";
    const lines = [`${head}: ${b.event_name}`, `${when} (${host.timezone})`, "", `${b.guest_name} <${b.guest_email}>`];
    if (b.guest_timezone) lines.push(`Their time zone: ${b.guest_timezone}`);
    for (const q of type?.questions ?? []) if (b.answers[q.id]) lines.push("", q.label, b.answers[q.id]);
    if (b.cancel_reason) lines.push("", "Reason", b.cancel_reason);
    const src = Object.entries(b.meta ?? {}).filter(([, v]) => v);
    if (src.length) lines.push("", src.map(([k, v]) => `${k}: ${v}`).join("\n"));
    if (b.meet_url && kind !== "cancelled") lines.push("", `Meet: ${b.meet_url}`);
    lines.push("", `All bookings: ${siteUrl()}/admin`);
    await sendMail({
      from: host.email,
      fromName: "open-cal",
      to: [host.email],
      replyTo: b.guest_email,
      subject: `${head}: ${b.guest_name} - ${b.event_name}`,
      text: lines.join("\n"),
    });
  } catch (e) {
    console.error("[cal] host email failed", (e as Error)?.message);
  }
}
