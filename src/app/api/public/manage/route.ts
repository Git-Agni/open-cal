import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookingByToken, cancel, reschedule } from "@/lib/cal";
import { calError, readBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/manage { token, action: "cancel", reason? } | { token, action: "reschedule", start }
 * The guest's own link (in the invite): the token is the only key, 24 random bytes.
 */
export async function POST(req: Request) {
  try {
    const b = await readBody(req);
    const svc = db();
    const booking = typeof b.token === "string" ? await bookingByToken(svc, b.token) : null;
    if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (b.action === "cancel") {
      const row = await cancel(svc, booking, "guest", typeof b.reason === "string" ? b.reason.trim() : null);
      return NextResponse.json({ ok: true, status: row.status });
    }
    if (b.action === "reschedule") {
      const start = Date.parse(String(b.start ?? ""));
      if (!Number.isFinite(start)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
      const row = await reschedule(svc, booking, start);
      return NextResponse.json({ ok: true, start: row.start_at, end: row.end_at });
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  } catch (e) {
    const msg = (e as Error)?.message;
    if (msg === "slot_taken") return NextResponse.json({ error: "slot_taken" }, { status: 409 });
    if (msg === "booking_cancelled" || msg === "booking_past") return NextResponse.json({ error: msg }, { status: 409 });
    return calError(e);
  }
}
