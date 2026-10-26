/**
 * core.ts - open-cal's pure logic: time zones, slot generation, input checks.
 *
 * No IO, no `server-only`: the slot math runs on the server (cal.ts) and the unit tests, and the
 * types and question helpers are shared with the booking page and the admin page. No date
 * library: Intl.DateTimeFormat does the zone math, which keeps DST right everywhere.
 *
 * Time model: a host keeps weekly hours in THEIR time zone as wall-clock "HH:MM" ranges per
 * weekday (0 = Sunday), plus date overrides ("2026-12-24": [] closes the day). Every slot is
 * computed host-local and turned into a UTC instant with zonedToUtc, so DST shifts land on the
 * right hour. The guest's time zone only matters for display, in the browser.
 */

export type TimeRange = { start: string; end: string };
/** Weekday "0".."6" -> ranges, host-local. A missing or empty day is closed. */
export type WeeklyHours = Record<string, TimeRange[]>;
/** "YYYY-MM-DD" -> ranges for that one date (an empty list closes it). */
export type DateOverrides = Record<string, TimeRange[]>;
export type Interval = { start: number; end: number };

export type QuestionKind = "text" | "textarea" | "url" | "phone" | "select";
export type Question = { id: string; label: string; kind: QuestionKind; required: boolean; options?: string[] };

export type SlotRules = {
  duration_min: number;
  increment_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  min_notice_min: number;
  max_days_ahead: number;
  max_per_day: number | null;
};

/** Path segments that can never be a host slug: the manage page, the admin, Next and the API. */
export const RESERVED_SLUGS = ["b", "api", "_next", "admin", "login", "www", "embed"] as const;

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Mon-Fri 09:00-17:00: what a new host starts with. */
export const DEFAULT_WEEKLY: WeeklyHours = Object.fromEntries(
  [1, 2, 3, 4, 5].map((d) => [String(d), [{ start: "09:00", end: "17:00" }]]),
);

/** What a new event type asks, on top of name, email and optional guests: Calendly's one note. */
export const DEFAULT_QUESTIONS: Question[] = [
  { id: "agenda", label: "Please share anything that will help prepare for our meeting.", kind: "textarea", required: true },
];

/** Most extra guests one booking may invite. */
export const MAX_GUESTS = 10;

export const DEFAULT_RULES: SlotRules = {
  duration_min: 30,
  increment_min: 30,
  buffer_before_min: 0,
  buffer_after_min: 0,
  min_notice_min: 24 * 60,
  max_days_ahead: 60,
  max_per_day: null,
};

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/* ── Time zones ───────────────────────────────────────────────────────────────────── */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Is `tz` an IANA zone this runtime knows? */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}

function parts(instant: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const p: Record<string, number> = {};
  for (const x of dtf(tz).formatToParts(new Date(instant))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute, s: p.second };
}

/** The zone's offset from UTC at `instant`, in ms (Berlin in summer = +7_200_000). */
export function tzOffsetMs(instant: number, tz: string): number {
  const p = parts(instant, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "2026-03-29" + "09:30" in `tz` -> the UTC instant. A wall time skipped by DST moves forward. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffsetMs(guess, tz);
  const second = guess - tzOffsetMs(first, tz);
  return second;
}

/** The host-local calendar date of `instant`, "YYYY-MM-DD". */
export function localDate(instant: number, tz: string): string {
  const p = parts(instant, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** The host-local "HH:MM" of `instant`. */
export function localTime(instant: number, tz: string): string {
  const p = parts(instant, tz);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** "YYYY-MM-DD" plus `n` days (calendar arithmetic, zone-free). */
export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d) + n * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 (Sunday) .. 6 for a "YYYY-MM-DD". */
export function weekday(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isHhmm = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(s);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/* ── Intervals ────────────────────────────────────────────────────────────────────── */

/** Sorted, overlapping or touching intervals joined. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function overlaps(busy: Interval[], start: number, end: number): boolean {
  // busy is merged and sorted; a linear scan is fine at calendar sizes (tens of entries).
  for (const b of busy) {
    if (b.start >= end) return false;
    if (b.end > start) return true;
  }
  return false;
}

/** Remove one interval (a booking being rescheduled) from a busy list. */
export function withoutInterval(busy: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const b of busy) {
    if (b.end <= cut.start || b.start >= cut.end) {
      out.push(b);
      continue;
    }
    if (b.start < cut.start) out.push({ start: b.start, end: cut.start });
    if (b.end > cut.end) out.push({ start: cut.end, end: b.end });
  }
  return out;
}

/* ── Slots ────────────────────────────────────────────────────────────────────────── */

export type SlotInput = {
  timezone: string;
  weekly: WeeklyHours;
  overrides: DateOverrides;
  rules: SlotRules;
  /** Busy time from every calendar that counts, UTC ms. */
  busy: Interval[];
  /** Live bookings of this event type per host-local date (for max_per_day). */
  bookedPerDay?: Record<string, number>;
  now: number;
  /** Host-local dates, inclusive. */
  fromDate: string;
  toDate: string;
};

export type Slot = { start: number; end: number; date: string };

/** The ranges open on one host-local date: the override if there is one, else the weekday's. */
export function rangesFor(date: string, weekly: WeeklyHours, overrides: DateOverrides): TimeRange[] {
  if (Object.prototype.hasOwnProperty.call(overrides, date)) return overrides[date] ?? [];
  return weekly[String(weekday(date))] ?? [];
}

/**
 * Every bookable start between fromDate and toDate (host-local, inclusive). A slot is open when
 * it sits wholly inside an open range, starts at least min_notice after now and no later than
 * max_days_ahead, and the slot plus its buffers touches no busy time.
 */
export function generateSlots(input: SlotInput): Slot[] {
  const { timezone, weekly, overrides, rules, now } = input;
  const busy = mergeIntervals(input.busy);
  const earliest = now + rules.min_notice_min * MIN;
  const latest = now + rules.max_days_ahead * DAY;
  const step = Math.max(5, rules.increment_min) * MIN;
  const dur = rules.duration_min * MIN;
  const out: Slot[] = [];
  let date = input.fromDate;
  for (let guard = 0; date <= input.toDate && guard < 400; guard++, date = addDays(date, 1)) {
    // max_per_day caps BOOKINGS, not offered slots: a day under the cap shows every open slot.
    if (rules.max_per_day != null && (input.bookedPerDay?.[date] ?? 0) >= rules.max_per_day) continue;
    for (const r of rangesFor(date, weekly, overrides)) {
      if (!isHhmm(r.start) || !isHhmm(r.end) || minutes(r.end) <= minutes(r.start)) continue;
      const winStart = zonedToUtc(date, r.start, timezone);
      const winEnd = r.end === "24:00" ? zonedToUtc(addDays(date, 1), "00:00", timezone) : zonedToUtc(date, r.end, timezone);
      for (let s = winStart; s + dur <= winEnd; s += step) {
        if (s < earliest || s > latest) continue;
        if (overlaps(busy, s - rules.buffer_before_min * MIN, s + dur + rules.buffer_after_min * MIN)) continue;
        out.push({ start: s, end: s + dur, date });
      }
    }
  }
  return out;
}

/** True when `start` is one of the open slots on its own host-local date. */
export function isOpenSlot(start: number, input: Omit<SlotInput, "fromDate" | "toDate">): boolean {
  const date = localDate(start, input.timezone);
  return generateSlots({ ...input, fromDate: date, toDate: date }).some((s) => s.start === start);
}

/* ── Input checks ─────────────────────────────────────────────────────────────────── */

export function isSlug(s: unknown, max = 41): s is string {
  return typeof s === "string" && s.length <= max && /^[a-z0-9][a-z0-9-]*$/.test(s);
}

export function isHostSlug(s: unknown): s is string {
  return isSlug(s, 41) && s.length >= 2 && !(RESERVED_SLUGS as readonly string[]).includes(s);
}

/** "Ada Lovelace" -> "ada-lovelace". */
export function slugify(s: string, max = 40): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

export function isEmail(s: unknown): s is string {
  return typeof s === "string" && s.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(s);
}

/** A clean weekly-hours object, or null when it is not one. Ranges are sorted per day. */
export function parseWeekly(v: unknown): WeeklyHours | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: WeeklyHours = {};
  for (const [k, ranges] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(k)) return null;
    const list = parseRanges(ranges);
    if (!list) return null;
    if (list.length) out[k] = list;
  }
  return out;
}

export function parseOverrides(v: unknown): DateOverrides | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: DateOverrides = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 400) return null;
  for (const [k, ranges] of entries) {
    if (!isDate(k)) return null;
    const list = parseRanges(ranges);
    if (!list) return null;
    out[k] = list;
  }
  return out;
}

function parseRanges(v: unknown): TimeRange[] | null {
  if (!Array.isArray(v) || v.length > 6) return null;
  const list: TimeRange[] = [];
  for (const r of v) {
    const start = (r as TimeRange)?.start;
    const end = (r as TimeRange)?.end;
    if (!isHhmm(start) || !isHhmm(end) || minutes(end) <= minutes(start)) return null;
    list.push({ start, end });
  }
  return list.sort((a, b) => minutes(a.start) - minutes(b.start));
}

const KINDS: QuestionKind[] = ["text", "textarea", "url", "phone", "select"];

/** A clean question list (max 10), or null. Ids are slugs, unique, and never "name"/"email". */
export function parseQuestions(v: unknown): Question[] | null {
  if (!Array.isArray(v) || v.length > 10) return null;
  const seen = new Set<string>(["name", "email"]);
  const out: Question[] = [];
  for (const q of v) {
    const id = (q as Question)?.id;
    const label = String((q as Question)?.label ?? "").trim();
    const kind = (q as Question)?.kind;
    if (!isSlug(id, 40) || seen.has(id) || !label || label.length > 300 || !KINDS.includes(kind)) return null;
    seen.add(id);
    const item: Question = { id, label, kind, required: Boolean((q as Question).required) };
    if (kind === "select") {
      const opts = Array.isArray((q as Question).options) ? (q as Question).options!.map((o) => String(o).trim()).filter(Boolean) : [];
      if (opts.length < 2 || opts.length > 20 || opts.some((o) => o.length > 120)) return null;
      item.options = opts;
    }
    out.push(item);
  }
  return out;
}

export type BookingForm = { name: string; email: string; answers: Record<string, string>; guests: string[] };

/** Check a guest's form against the questions: trimmed answers, or the first problem. */
export function checkAnswers(
  questions: Question[],
  raw: { name?: unknown; email?: unknown; answers?: unknown; guests?: unknown },
): { ok: true; form: BookingForm } | { ok: false; error: string } {
  const name = String(raw.name ?? "").trim();
  const email = String(raw.email ?? "").trim().toLowerCase();
  if (!name || name.length > 120) return { ok: false, error: "name_required" };
  if (!isEmail(email)) return { ok: false, error: "email_invalid" };
  const given = raw.answers && typeof raw.answers === "object" ? (raw.answers as Record<string, unknown>) : {};
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const a = String(given[q.id] ?? "").trim();
    if (!a) {
      if (q.required) return { ok: false, error: `answer_required:${q.id}` };
      continue;
    }
    if (a.length > (q.kind === "textarea" ? 3000 : 500)) return { ok: false, error: `answer_too_long:${q.id}` };
    if (q.kind === "select" && !q.options?.includes(a)) return { ok: false, error: `answer_invalid:${q.id}` };
    answers[q.id] = a;
  }
  const guests = parseGuests(raw.guests, email);
  if (!guests) return { ok: false, error: "guests_invalid" };
  return { ok: true, form: { name, email, answers, guests } };
}

/**
 * Extra guests ("Add guests"): a list or a comma / space / newline separated string of emails,
 * lowercased and de-duplicated, without the booker's own address. Null when one is not an email
 * or there are more than MAX_GUESTS.
 */
export function parseGuests(v: unknown, own = ""): string[] | null {
  if (v == null || v === "") return [];
  const parts = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[\s,;]+/) : null;
  if (!parts) return null;
  const list = [...new Set(parts.map((x) => x.trim().toLowerCase()).filter(Boolean))].filter((x) => x !== own);
  if (list.length > MAX_GUESTS || list.some((x) => !isEmail(x))) return null;
  return list;
}

/** Clamp a rules object coming from the admin to what the table's checks accept. */
export function parseRules(v: Partial<Record<keyof SlotRules, unknown>>, base: SlotRules = DEFAULT_RULES): SlotRules | null {
  const int = (x: unknown, lo: number, hi: number, fallback: number) => {
    if (x === undefined) return fallback;
    const n = Number(x);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN;
  };
  const r: SlotRules = {
    duration_min: int(v.duration_min, 5, 480, base.duration_min),
    increment_min: int(v.increment_min, 5, 240, base.increment_min),
    buffer_before_min: int(v.buffer_before_min, 0, 240, base.buffer_before_min),
    buffer_after_min: int(v.buffer_after_min, 0, 240, base.buffer_after_min),
    min_notice_min: int(v.min_notice_min, 0, 43200, base.min_notice_min),
    max_days_ahead: int(v.max_days_ahead, 1, 365, base.max_days_ahead),
    max_per_day: v.max_per_day === null || v.max_per_day === "" ? null : int(v.max_per_day, 1, 50, base.max_per_day ?? NaN),
  };
  if (v.max_per_day === undefined) r.max_per_day = base.max_per_day;
  return Object.values(r).some((x) => typeof x === "number" && Number.isNaN(x)) ? null : r;
}

/* ── Display ──────────────────────────────────────────────────────────────────────── */

/** "15 min", "1 h", "1 h 30 min". */
export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Where this deploy lives, no trailing slash: NEXT_PUBLIC_SITE_URL when set (inlined into the
 * browser bundle at build time), else the page's own origin in the browser, else Vercel's
 * production domain, else localhost.
 */
export function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

/** The public URL of a host page or event type. */
export function calUrl(hostSlug: string, typeSlug?: string): string {
  return `${siteUrl()}/${hostSlug}${typeSlug ? `/${typeSlug}` : ""}`;
}

/** The guest's reschedule / cancel link. */
export function manageUrl(token: string): string {
  return `${siteUrl()}/b/${token}`;
}
