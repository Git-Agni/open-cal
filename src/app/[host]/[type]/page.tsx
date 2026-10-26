import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { isHostSlug, isSlug } from "@/lib/core";
import { eventType, hostBySlug, publicHost, publicType } from "@/lib/cal";
import { Booker } from "../../Booker";
import s from "../../ui.module.css";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string; type: string }> };

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

/** /<host>/<type>: the booking widget. */
export default async function TypePage({ params }: Params) {
  const { host: h, type: t } = await params;
  const hit = await load(h, t);
  if (!hit) notFound();
  return (
    <main className={s.wrap}>
      <p className={s.empty} style={{ marginBottom: 12 }}>
        <Link href={`/${hit.host.slug}`} style={{ color: "inherit" }}>
          ← {hit.host.name}
        </Link>
      </p>
      <Booker host={publicHost(hit.host)} type={publicType(hit.type)} />
    </main>
  );
}
