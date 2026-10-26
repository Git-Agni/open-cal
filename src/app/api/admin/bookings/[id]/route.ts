import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookingById, cancel } from "@/lib/cal";
import { calError, isUuid, readBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/admin/bookings/:id { reason? } - cancel from the admin; Google tells the guest. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new Error("not_found");
    const svc = db();
    const booking = await bookingById(svc, id);
    if (!booking) throw new Error("not_found");
    const b = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const reason = typeof b.reason === "string" ? b.reason.trim() : null;
    const row = await cancel(svc, booking, "host", reason);
    return NextResponse.json({ booking: row });
  } catch (e) {
    return calError(e);
  }
}
