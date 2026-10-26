import { NextResponse } from "next/server";
import { adminConfigured, checkPassword, newSessionValue, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tries = new Map<string, { n: number; until: number }>();

/** POST /api/admin/login { password } - sets the session cookie. Slows down guessing per IP. */
export async function POST(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const t = tries.get(ip);
  if (t && t.n >= 5 && t.until > Date.now()) return NextResponse.json({ error: "too_many_tries" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  if (!checkPassword(body?.password)) {
    const n = t && t.until > Date.now() ? t.n + 1 : 1;
    tries.set(ip, { n, until: Date.now() + 15 * 60_000 });
    return NextResponse.json({ error: "wrong_password" }, { status: 401 });
  }
  tries.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(newSessionValue()));
  return res;
}
