import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addDays, isDate, isHostSlug, isSlug } from "@/lib/core";
import { availability, bookingByToken, eventType, hostBySlug } from "@/lib/cal";
import { calError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/public/slots?host=&type=&from=YYYY-MM-DD&to=YYYY-MM-DD[&token=]
 * The open starts (ISO) for one event type, host-local dates inclusive, at most 42 days at a
 * time. With a booking's manage token the booking's own time counts as free (reschedule).
 * Public: answers only start times, never what the busy time is.
 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const hostSlug = q.get("host");
    const typeSlug = q.get("type");
    const from = q.get("from");
    const to = q.get("to");
    if (!isHostSlug(hostSlug) || !isSlug(typeSlug, 61) || !isDate(from) || !isDate(to) || to < from || addDays(from, 42) < to) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    const svc = db();
    const host = await hostBySlug(svc, hostSlug);
    const type = host?.active ? await eventType(svc, host.id, typeSlug) : null;
    if (!host || !type?.active) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let exclude: { start: number; end: number } | undefined;
    const token = q.get("token");
    if (token) {
      const b = await bookingByToken(svc, token);
      if (b && b.host_id === host.id && b.status === "confirmed") exclude = { start: Date.parse(b.start_at), end: Date.parse(b.end_at) };
    }
    const { slots } = await availability(svc, host, type, from, to, { exclude });
    return NextResponse.json({ timezone: host.timezone, slots: slots.map((s) => new Date(s.start).toISOString()) });
  } catch (e) {
    return calError(e);
  }
}
