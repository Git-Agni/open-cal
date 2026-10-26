import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_WEEKLY, isEmail, isHostSlug, isTimeZone } from "@/lib/core";
import { eventTypes, hostByEmail, hostById, listBookings, listHosts, type CalHost } from "@/lib/cal";
import { calendarConfigured } from "@/lib/google";
import { calError, isUuid, readBody, slugConflict } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * GET /api/admin?host=<id> - the admin page in one read: every host, the selected one (the
 * first by default), its event types and its bookings from 30 days back.
 */
export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const svc = db();
    const hosts = await listHosts(svc);
    const want = new URL(req.url).searchParams.get("host");
    let host: CalHost | null = hosts[0] ?? null;
    if (want && isUuid(want)) host = (await hostById(svc, want)) ?? host;
    const types = host ? await eventTypes(svc, host.id) : [];
    const bookings = host ? await listBookings(svc, [host.id], Date.now() - 30 * DAY) : [];
    return NextResponse.json({
      googleReady: calendarConfigured(),
      hosts: hosts.map((h) => ({ id: h.id, name: h.name, slug: h.slug, email: h.email, active: h.active })),
      host,
      types,
      bookings,
    });
  } catch (e) {
    return calError(e);
  }
}

/** POST /api/admin { email, slug, name, timezone? } - set up a booking page for a Workspace user. */
export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const b = await readBody(req);
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
    const timezone = b.timezone ?? "UTC";
    if (!isEmail(email) || !name || !isHostSlug(b.slug) || !isTimeZone(timezone)) throw new Error("invalid_input");
    const svc = db();
    if (await hostByEmail(svc, email)) throw new Error("host_exists");
    const ins = await svc
      .from("cal_hosts")
      .insert({ email, slug: b.slug, name, timezone, weekly_hours: DEFAULT_WEEKLY, busy_calendar_ids: [email] })
      .select("*")
      .single();
    if (slugConflict(ins.error)) throw new Error("slug_taken");
    if (ins.error) throw new Error(ins.error.message);
    return NextResponse.json({ host: ins.data });
  } catch (e) {
    return calError(e);
  }
}
