import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import type { CalEventType } from "@/lib/cal";
import { calError, isUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/types/:id/duplicate - a copy of an event type with everything on it (length,
 * notice, hours, dates, calendars, questions, guests), named "<name> (copy)" on the first free
 * "<slug>-copy[-n]" link. It starts switched off, so nothing new is public until it is edited.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new Error("not_found");
    const svc = db();
    const { data } = await svc.from("cal_event_types").select("*").eq("id", id).maybeSingle();
    if (!data) throw new Error("not_found");
    const src = data as CalEventType & Record<string, unknown>;

    const { data: rows } = await svc.from("cal_event_types").select("slug").eq("host_id", src.host_id);
    const taken = new Set((rows ?? []).map((r) => String(r.slug)));
    const base = `${src.slug}-copy`.slice(0, 55);
    let slug = base;
    for (let n = 2; taken.has(slug) && n < 100; n++) slug = `${base}-${n}`;

    const copy: Record<string, unknown> = { ...src };
    for (const k of ["id", "created_at", "updated_at", "previous_slugs"]) delete copy[k];
    Object.assign(copy, { slug, name: `${src.name} (copy)`.slice(0, 120), active: false, position: (src.position ?? 0) + 1 });

    const ins = await svc.from("cal_event_types").insert(copy).select("*").single();
    if (ins.error) throw new Error(ins.error.message);
    return NextResponse.json({ type: ins.data });
  } catch (e) {
    return calError(e);
  }
}
