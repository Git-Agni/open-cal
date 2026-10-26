import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { hostById } from "@/lib/cal";
import { freeBusy, listCalendars } from "@/lib/google";
import { calError, isUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/hosts/:id/calendars - what the host's Google account can see, and whether each
 * calendar that counts as busy answers free/busy right now (`errors` names the ones that do not:
 * not shared with the host, or shared without free/busy).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new Error("not_found");
    const host = await hostById(db(), id);
    if (!host) throw new Error("not_found");
    const calendars = await listCalendars(host.email);
    const now = Date.now();
    const check = await freeBusy(host.email, host.busy_calendar_ids.length ? host.busy_calendar_ids : [host.email], now, now + 7 * 86_400_000);
    return NextResponse.json({ calendars, errors: check.errors });
  } catch (e) {
    return calError(e);
  }
}
