import "server-only";
import { NextResponse } from "next/server";
import {
  isEmail,
  isHostSlug,
  isSlug,
  isTimeZone,
  parseOverrides,
  parseQuestions,
  parseRules,
  parseWeekly,
  type SlotRules,
} from "./core";
import type { CalEventType, CalHost } from "./cal";

/**
 * http.ts - the shared bits of the API routes: body reading, error codes, and the body parsers
 * for a host and an event type. Error codes are snake_case words the pages map to sentences.
 */

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("bad_json");
  return b as Record<string, unknown>;
}

const STATUS: Record<string, number> = {
  bad_json: 400,
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  slug_taken: 409,
  host_exists: 409,
  slot_taken: 409,
  too_many_bookings: 429,
  booking_cancelled: 409,
  booking_past: 409,
  database_not_configured: 503,
  calendar_not_configured: 503,
  calendar_not_authorized: 503,
  calendar_user_unknown: 400,
};

/** Our own codes go out as they are; anything else is logged and masked. */
export function calError(e: unknown): NextResponse {
  const msg = (e as Error)?.message ?? "";
  if (STATUS[msg]) return NextResponse.json({ error: msg }, { status: STATUS[msg] });
  console.error("[cal]", msg.slice(0, 500));
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}

/** A Postgres unique violation on a slug column reads as slug_taken. */
export function slugConflict(err: { code?: string; message?: string } | null): boolean {
  return err?.code === "23505";
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** The host fields a PATCH may set, checked. Throws invalid_input on anything off. */
export function parseHostPatch(b: Record<string, unknown>): Partial<CalHost> {
  const out: Partial<CalHost> = {};
  if ("name" in b) {
    const v = str(b.name, 80);
    if (!v) throw new Error("invalid_input");
    out.name = v;
  }
  if ("slug" in b) {
    if (!isHostSlug(b.slug)) throw new Error("invalid_input");
    out.slug = b.slug;
  }
  if ("headline" in b) out.headline = str(b.headline, 200) || null;
  if ("bio" in b) out.bio = str(b.bio, 1500) || null;
  if ("avatar_url" in b) {
    const v = str(b.avatar_url, 500) || null;
    if (v && !/^https:\/\//.test(v)) throw new Error("invalid_input");
    out.avatar_url = v;
  }
  if ("timezone" in b) {
    if (!isTimeZone(b.timezone)) throw new Error("invalid_input");
    out.timezone = b.timezone;
  }
  if ("weekly_hours" in b) {
    const v = parseWeekly(b.weekly_hours);
    if (!v) throw new Error("invalid_input");
    out.weekly_hours = v;
  }
  if ("date_overrides" in b) {
    const v = parseOverrides(b.date_overrides);
    if (!v) throw new Error("invalid_input");
    out.date_overrides = v;
  }
  if ("busy_calendar_ids" in b) {
    const v = b.busy_calendar_ids;
    if (!Array.isArray(v) || v.length > 50 || v.some((x) => typeof x !== "string" || !x || x.length > 300)) throw new Error("invalid_input");
    out.busy_calendar_ids = [...new Set(v as string[])];
  }
  if ("target_calendar_id" in b) {
    const v = b.target_calendar_id;
    if (v !== null && (typeof v !== "string" || v.length > 300)) throw new Error("invalid_input");
    out.target_calendar_id = (v as string | null) || null;
  }
  if ("active" in b) out.active = Boolean(b.active);
  return out;
}

/** The event-type fields a POST or PATCH may set, checked against `base` for the rules. */
export function parseTypePatch(b: Record<string, unknown>, base?: CalEventType): Partial<CalEventType> {
  const out: Partial<CalEventType> = {};
  if ("name" in b) {
    const v = str(b.name, 120);
    if (!v) throw new Error("invalid_input");
    out.name = v;
  }
  if ("slug" in b) {
    if (!isSlug(b.slug, 61)) throw new Error("invalid_input");
    out.slug = b.slug;
  }
  if ("description" in b) out.description = str(b.description, 3000) || null;
  if ("color" in b) {
    const v = b.color;
    if (v !== null && !(typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v))) throw new Error("invalid_input");
    out.color = (v as string | null) || null;
  }
  if ("questions" in b) {
    const v = parseQuestions(b.questions);
    if (!v) throw new Error("invalid_input");
    out.questions = v;
  }
  if ("extra_attendees" in b) {
    const v = b.extra_attendees;
    if (!Array.isArray(v) || v.length > 10 || v.some((x) => !isEmail(x))) throw new Error("invalid_input");
    out.extra_attendees = [...new Set((v as string[]).map((x) => x.toLowerCase()))];
  }
  if ("position" in b) {
    const n = Number(b.position);
    if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error("invalid_input");
    out.position = n;
  }
  if ("active" in b) out.active = Boolean(b.active);
  if ("allow_guests" in b) out.allow_guests = Boolean(b.allow_guests);
  if ("extra_busy_calendar_ids" in b) {
    const v = b.extra_busy_calendar_ids;
    if (!Array.isArray(v) || v.length > 20 || v.some((x) => typeof x !== "string" || !x.trim() || x.length > 300)) throw new Error("invalid_input");
    out.extra_busy_calendar_ids = [...new Set((v as string[]).map((x) => x.trim()))];
  }
  // Own hours: null goes back to the host's.
  if ("weekly_hours" in b) {
    if (b.weekly_hours === null) out.weekly_hours = null;
    else {
      const v = parseWeekly(b.weekly_hours);
      if (!v) throw new Error("invalid_input");
      out.weekly_hours = v;
    }
  }
  if ("date_overrides" in b) {
    if (b.date_overrides === null) out.date_overrides = null;
    else {
      const v = parseOverrides(b.date_overrides);
      if (!v) throw new Error("invalid_input");
      out.date_overrides = v;
    }
  }
  if ("timezone" in b) {
    if (b.timezone !== null && !isTimeZone(b.timezone)) throw new Error("invalid_input");
    out.timezone = (b.timezone as string | null) || null;
  }
  const ruleKeys: (keyof SlotRules)[] = ["duration_min", "increment_min", "buffer_before_min", "buffer_after_min", "min_notice_min", "max_days_ahead", "max_per_day"];
  if (ruleKeys.some((k) => k in b)) {
    const rules = parseRules(Object.fromEntries(ruleKeys.filter((k) => k in b).map((k) => [k, b[k]])), base);
    if (!rules) throw new Error("invalid_input");
    for (const k of ruleKeys) if (k in b) (out as Record<string, unknown>)[k] = rules[k];
  }
  return out;
}
