import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAnswers, isHostSlug, isSlug, isTimeZone, manageUrl } from "@/lib/core";
import { book, clientIp, eventType, hashIp, hostBySlug } from "@/lib/cal";
import { calError, readBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "referrer"] as const;

/**
 * POST /api/public/book { host, type, start, name, email, guests, answers, timezone, meta }
 * Books one slot (cal.ts book: live re-check, race-safe insert, Google event with Meet). No
 * honeypot field: browser autofill fills hidden fields for real guests, who then saw a fake
 * "You're booked". The per-network rate limit in the book flow is the spam guard.
 */
export async function POST(req: Request) {
  try {
    const b = await readBody(req);
    const start = Date.parse(String(b.start ?? ""));
    if (!isHostSlug(b.host) || !isSlug(b.type, 61) || !Number.isFinite(start)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const svc = db();
    const host = await hostBySlug(svc, b.host);
    const type = host?.active ? await eventType(svc, host.id, b.type) : null;
    if (!host || !type?.active) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const checked = checkAnswers(type.questions, { name: b.name, email: b.email, answers: b.answers, guests: b.guests });
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

    const rawMeta = b.meta && typeof b.meta === "object" ? (b.meta as Record<string, unknown>) : {};
    const meta: Record<string, string> = {};
    for (const k of META_KEYS) if (typeof rawMeta[k] === "string" && rawMeta[k]) meta[k] = (rawMeta[k] as string).slice(0, 300);

    const booking = await book(svc, {
      host,
      type,
      start,
      form: checked.form,
      guestTimezone: isTimeZone(b.timezone) ? b.timezone : null,
      meta,
      ipHash: hashIp(clientIp(req)),
    });
    return NextResponse.json({
      ok: true,
      booking: {
        start: booking.start_at,
        end: booking.end_at,
        event: booking.event_name,
        host: host.name,
        meet_url: booking.meet_url,
        manage_url: manageUrl(booking.manage_token),
        email: booking.guest_email,
      },
    });
  } catch (e) {
    const msg = (e as Error)?.message;
    if (msg === "slot_taken") return NextResponse.json({ error: "slot_taken" }, { status: 409 });
    if (msg === "too_many_bookings") return NextResponse.json({ error: "too_many_bookings" }, { status: 429 });
    return calError(e);
  }
}
