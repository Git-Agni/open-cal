import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * auth.ts - one password for the admin page (ADMIN_PASSWORD). Signing in sets an httpOnly
 * cookie `<expiry>.<hmac>` keyed by the password itself, so changing the password signs
 * everyone out and there is no session table. Good for one owner or a small team; put real
 * auth in front if you need per-person access.
 */

export const SESSION_COOKIE = "oc_session";
const SESSION_DAYS = 30;

function secret(): string | null {
  const p = process.env.ADMIN_PASSWORD;
  return p && p.length >= 12 ? p : null;
}

function sign(exp: number, key: string): string {
  return createHmac("sha256", key).update(`open-cal-session:${exp}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Is the admin password set (and long enough)? Without it the admin stays locked. */
export function adminConfigured(): boolean {
  return secret() !== null;
}

export function checkPassword(given: unknown): boolean {
  const key = secret();
  if (!key || typeof given !== "string") return false;
  // Compare HMACs so the length of the real password does not leak through timing.
  return safeEqual(sign(0, `${key}:${given}`), sign(0, `${key}:${key}`));
}

export function newSessionValue(now = Date.now()): string {
  const key = secret();
  if (!key) throw new Error("admin_not_configured");
  const exp = now + SESSION_DAYS * 86_400_000;
  return `${exp}.${sign(exp, key)}`;
}

export function validSession(value: string | undefined | null, now = Date.now()): boolean {
  const key = secret();
  if (!key || !value) return false;
  const [expRaw, mac] = value.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < now || !mac) return false;
  return safeEqual(mac, sign(exp, key));
}

export const sessionCookie = (value: string) => ({
  name: SESSION_COOKIE,
  value,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 86_400,
});

/** For server components: is this request signed in? */
export async function isAdmin(): Promise<boolean> {
  return validSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * For /api/admin routes: null when signed in, else the 401 to return. Writes also need a
 * same-origin request (the cookie is SameSite=Lax, this closes the rest of CSRF).
 */
export async function requireAdmin(req: Request): Promise<NextResponse | null> {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
