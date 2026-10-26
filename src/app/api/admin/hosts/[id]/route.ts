import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { hostById } from "@/lib/cal";
import { calError, isUuid, parseHostPatch, readBody, slugConflict } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/admin/hosts/:id - page details, hours, days off, calendars, on/off. */
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new Error("not_found");
    const svc = db();
    if (!(await hostById(svc, id))) throw new Error("not_found");
    const patch = parseHostPatch(await readBody(req));
    const r = await svc.from("cal_hosts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
    if (slugConflict(r.error)) throw new Error("slug_taken");
    if (r.error) throw new Error(r.error.message);
    return NextResponse.json({ host: r.data });
  } catch (e) {
    return calError(e);
  }
}

/** DELETE /api/admin/hosts/:id - event types and bookings go with it. */
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new Error("not_found");
    const r = await db().from("cal_hosts").delete().eq("id", id);
    if (r.error) throw new Error(r.error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return calError(e);
  }
}
