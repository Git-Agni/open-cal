import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alertUnreadable, syncBookings, unreadableCalendars } from "@/lib/cal";

/**
 * /api/jobs/cal-sync - Google Calendar back into open-cal (Vercel cron, vercel.json).
 *
 * A booking whose meeting was deleted in Google is cancelled here (its slot opens again) and one
 * moved in Google takes the new time. Without it a meeting deleted by hand kept its minute
 * booked until a guest tried that exact minute.
 *
 * ?calendars=1: also checks every busy calendar is still readable and, with HOST_EMAILS=gmail,
 * emails the host when one is not, since its meetings would silently stop blocking times.
 * Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel cron sends it for you).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const svc = db();
    const sync = await syncBookings(svc);
    let unreadable: { host: string; calendars: string[] }[] | undefined;
    if (new URL(req.url).searchParams.get("calendars") === "1") {
      const bad = await unreadableCalendars(svc);
      for (const b of bad) await alertUnreadable(b.host, b.calendars);
      unreadable = bad.map((b) => ({ host: b.host.slug, calendars: b.calendars }));
    }
    console.log("[cal-sync]", JSON.stringify({ ...sync, unreadable }));
    return NextResponse.json({ ok: true, ...sync, unreadable });
  } catch (e) {
    console.error("[cal-sync]", (e as Error)?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
