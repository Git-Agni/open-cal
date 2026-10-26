"use client";

import { useState } from "react";
import s from "../../ui.module.css";

const ERR: Record<string, string> = {
  wrong_password: "That password is not right.",
  too_many_tries: "Too many tries. Wait 15 minutes.",
};

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "failed");
      window.location.href = "/admin";
    } catch (e2) {
      setErr(ERR[(e2 as Error).message] ?? "Could not sign in. Try again.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
      <label className={s.label}>
        <span>Admin password</span>
        <input className={s.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </label>
      {err && (
        <p className={s.error} role="alert">
          {err}
        </p>
      )}
      <div className={s.actions}>
        <button type="submit" className={s.primary} disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
