import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_QUESTIONS, DEFAULT_RULES } from "@/lib/core";
import { hostById } from "@/lib/cal";
import { calError, isUuid, parseTypePatch, readBody, slugConflict } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/types { host_id, name, slug, ...rules } - a new event type (default questions). */
export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const b = await readBody(req);
    if (!isUuid(b.host_id)) throw new Error("invalid_input");
    const svc = db();
    const host = await hostById(svc, b.host_id);
    if (!host) throw new Error("not_found");
    const fields = parseTypePatch(b);
    if (!fields.name || !fields.slug) throw new Error("invalid_input");
    const row = { ...DEFAULT_RULES, questions: DEFAULT_QUESTIONS, ...fields, host_id: host.id };
    const ins = await svc.from("cal_event_types").insert(row).select("*").single();
    if (slugConflict(ins.error)) throw new Error("slug_taken");
    if (ins.error) throw new Error(ins.error.message);
    return NextResponse.json({ type: ins.data });
  } catch (e) {
    return calError(e);
  }
}
