import { redirect } from "next/navigation";
import { adminConfigured, isAdmin } from "@/lib/auth";
import { LoginForm } from "./LoginForm";
import s from "../../ui.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in - open-cal" };

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <main className={`${s.wrap} ${s.narrow}`}>
      <div className={`${s.card} ${s.form}`}>
        <div className={s.eyebrow}>open-cal admin</div>
        {adminConfigured() ? (
          <LoginForm />
        ) : (
          <p className={s.error}>Set ADMIN_PASSWORD (12+ characters) in the environment and redeploy to unlock the admin.</p>
        )}
      </div>
    </main>
  );
}
