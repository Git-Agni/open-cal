import Link from "next/link";
import { redirect } from "next/navigation";
import { isHostSlug } from "@/lib/core";
import s from "./ui.module.css";

export const dynamic = "force-dynamic";

/** The bare domain: send visitors to DEFAULT_HOST's page when set, else a small pointer. */
export default function Home() {
  const slug = process.env.DEFAULT_HOST;
  if (isHostSlug(slug)) redirect(`/${slug}`);
  return (
    <main className={`${s.wrap} ${s.narrow}`}>
      <div className={`${s.card} ${s.done}`}>
        <div className={s.eyebrow}>open-cal</div>
        <h2 className={s.title}>Nothing to book at this address.</h2>
        <p className={s.sub}>If you have a link to someone&apos;s booking page, open that one.</p>
        <p className={s.sub} style={{ marginTop: 18 }}>
          <Link href="/admin" style={{ color: "inherit" }}>
            Admin
          </Link>
        </p>
      </div>
    </main>
  );
}
