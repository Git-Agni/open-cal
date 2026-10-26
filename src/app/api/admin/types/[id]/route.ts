import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import type { CalEventType } from "@/lib/cal";
import { calError, isUuid, parseTypePatch, readBody, slugConflict } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string): Promise<CalEventType> {
  if (!isUuid(id)) throw new Error("not_found");
  const { data } = await db().from("cal_event_types").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Error("not_found");
  return data as CalEventType;
}

/** PATCH /api/admin/types/:id - edit an event type. */
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const current = await load(id);
    const patch = parseTypePatch(await readBody(req), current);
    // A new link keeps the old one alive as a redirect, so shared links never break.
    if (patch.slug && patch.slug !== current.slug) {
      patch.previous_slugs = [...new Set([...(current.previous_slugs ?? []), current.slug])].filter((s) => s !== patch.slug);
    }
    const r = await db().from("cal_event_types").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
    if (slugConflict(r.error)) throw new Error("slug_taken");
    if (r.error) throw new Error(r.error.message);
    return NextResponse.json({ type: r.data });
  } catch (e) {
    return calError(e);
  }
}

/** DELETE /api/admin/types/:id - past bookings keep their event name. */
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    await load(id);
    const r = await db().from("cal_event_types").delete().eq("id", id);
    if (r.error) throw new Error(r.error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return calError(e);
  }
}
