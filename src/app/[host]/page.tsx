import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fmtDuration, isHostSlug } from "@/lib/core";
import { eventTypes, hostBySlug } from "@/lib/cal";
import { RichText } from "../RichText";
import s from "../ui.module.css";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { host: slug } = await params;
  const host = isHostSlug(slug) ? await hostBySlug(db(), slug) : null;
  return host?.active ? { title: { absolute: `Book a call with ${host.name}` } } : {};
}

/** /<host>: who you are booking, and their event types. */
export default async function HostPage({ params }: Params) {
  const { host: slug } = await params;
  if (!isHostSlug(slug)) notFound();
  const svc = db();
  const host = await hostBySlug(svc, slug);
  if (!host?.active) notFound();
  const types = await eventTypes(svc, host.id, { activeOnly: true });
  return (
    <main className={`${s.wrap} ${s.narrow}`}>
      <div className={s.hostHead}>
        {host.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={s.avatar} src={host.avatar_url} alt="" />
        ) : (
          <div className={s.avatar} aria-hidden="true">
            {host.name.slice(0, 1)}
          </div>
        )}
        <div>
          <div className={s.eyebrow}>Book a call</div>
          <h2 className={s.title}>{host.name}</h2>
          {host.headline && (
            <p className={`${s.sub} ${s.rich}`}>
              <RichText text={host.headline} />
            </p>
          )}
        </div>
      </div>
      {host.bio && (
        <p className={`${s.bio} ${s.rich}`} style={{ margin: "-8px 0 24px" }}>
          <RichText text={host.bio} />
        </p>
      )}
      <div className={s.types}>
        {types.map((t) => (
          <Link key={t.id} href={`/${host.slug}/${t.slug}`} className={`${s.card} ${s.typeCard}`}>
            <div>
              <div className={s.typeName}>{t.name}</div>
              <div className={s.typeMeta}>{fmtDuration(t.duration_min)} · Google Meet</div>
            </div>
            <span className={s.arrow} aria-hidden="true">
              →
            </span>
          </Link>
        ))}
        {types.length === 0 && <p className={s.empty}>Nothing to book here right now.</p>}
      </div>
    </main>
  );
}
