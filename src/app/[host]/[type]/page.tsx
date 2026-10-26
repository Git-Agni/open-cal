import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { db } from "@/lib/db";
import { addDays, isHostSlug, isSlug, localDate } from "@/lib/core";
import { availability, eventType, eventTypeByOldSlug, hostBySlug, publicHost, publicType, scheduleFor } from "@/lib/cal";
import { Booker } from "../../Booker";
import s from "../../ui.module.css";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string; type: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

async function load(hostSlug: string, typeSlug: string) {
  if (!isHostSlug(hostSlug) || !isSlug(typeSlug, 61)) return null;
  const svc = db();
  const host = await hostBySlug(svc, hostSlug);
  if (!host?.active) return null;
  const type = await eventType(svc, host.id, typeSlug);
  return type?.active ? { host, type } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { host, type } = await params;
  const hit = await load(host, type);
  return hit ? { title: { absolute: `${hit.type.name} - ${hit.host.name}` }, description: hit.type.description ?? undefined } : {};
}

/**
 * /<host>/<type>: the booking widget, on its own. Someone sent to one event's link sees that
 * event only, with no way back to the host's other events.
 */
export default async function TypePage({ params, searchParams }: Params) {
  const { host: h, type: t } = await params;
  const hit = await load(h, t);
  if (!hit) {
    // A renamed event: send the old link to the new one, query (utm_ tags) and all.
    if (isHostSlug(h) && isSlug(t, 61)) {
      const svc = db();
      const host = await hostBySlug(svc, h);
      const moved = host?.active ? await eventTypeByOldSlug(svc, host.id, t) : null;
      if (host && moved?.active) {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries((await searchParams) ?? {})) if (typeof v === "string") q.set(k, v);
        permanentRedirect(`/${host.slug}/${moved.slug}${q.size ? `?${q}` : ""}`);
      }
    }
    notFound();
  }
  // The whole booking window's times come with the page (one free/busy read), so the calendar
  // paints ready and month changes are instant. If Google is slow or down, the widget fetches.
  let initialSlots: string[] | undefined;
  try {
    const today = localDate(Date.now(), scheduleFor(hit.host, hit.type).timezone);
    const { slots } = await availability(db(), hit.host, hit.type, today, addDays(today, hit.type.max_days_ahead + 1));
    initialSlots = slots.map((x) => new Date(x.start).toISOString());
  } catch (e) {
    console.error("[cal] initial slots", (e as Error)?.message);
  }
  return (
    <main className={s.wrap}>
      <Booker host={publicHost(hit.host)} type={publicType(hit.type, hit.host)} initialSlots={initialSlots} />
    </main>
  );
}
