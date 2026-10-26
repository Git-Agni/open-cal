"use client";

import { useEffect, useState } from "react";
import type { PublicEventType, PublicHost } from "@/lib/cal";
import { Booker } from "../../Booker";
import s from "../../ui.module.css";

type BookingView = { event: string; start: string; status: "confirmed" | "cancelled"; past: boolean; meet_url: string | null };

/** The manage page body: the booking, then Reschedule (the Booker on this booking) or Cancel. */
export function ManageView({ token, host, type, booking }: { token: string; host: PublicHost; type: PublicEventType | null; booking: BookingView }) {
  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [status, setStatus] = useState(booking.status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [when, setWhen] = useState(booking.start);
  useEffect(() => {
    setWhen(
      new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(booking.start)),
    );
  }, [booking.start]);

  if (mode === "move" && type) return <Booker host={host} type={type} reschedule={{ token, currentStart: booking.start }} />;

  const cancel = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/public/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "cancel", reason }),
      });
      if (!r.ok) throw new Error();
      setStatus("cancelled");
      setMode("view");
    } catch {
      setErr("Could not cancel just now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const live = status === "confirmed" && !booking.past;
  return (
    <div className={`${s.card} ${s.done} ${s.narrow}`} style={{ margin: "0 auto" }}>
      <div className={s.eyebrow}>{status === "cancelled" ? "Cancelled" : booking.past ? "This meeting has passed" : "Your booking"}</div>
      <h2 className={s.title}>{booking.event}</h2>
      <p className={s.sub}>
        {when} with {host.name}
      </p>
      {live && booking.meet_url && (
        <p className={s.sub}>
          <a href={booking.meet_url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
            Join on Google Meet
          </a>
        </p>
      )}
      {live && mode === "view" && (
        <div className={s.actions} style={{ justifyContent: "center", marginTop: 24 }}>
          {type && (
            <button type="button" className={s.primary} onClick={() => setMode("move")}>
              Reschedule
            </button>
          )}
          <button type="button" className={`${s.ghost} ${s.danger}`} onClick={() => setMode("cancel")}>
            Cancel
          </button>
        </div>
      )}
      {live && mode === "cancel" && (
        <div className={s.form} style={{ textAlign: "left", padding: "24px 0 0" }}>
          <label className={s.label}>
            <span>Anything {host.name.split(" ")[0]} should know? (optional)</span>
            <textarea className={s.textarea} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </label>
          {err && <p className={s.error}>{err}</p>}
          <div className={s.actions}>
            <button type="button" className={`${s.primary}`} disabled={busy} onClick={cancel}>
              {busy ? "Cancelling…" : "Cancel the meeting"}
            </button>
            <button type="button" className={s.ghost} disabled={busy} onClick={() => setMode("view")}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {status === "cancelled" && type && (
        <p className={s.sub} style={{ marginTop: 18 }}>
          Want another time? Book again from {host.name}&apos;s page.
        </p>
      )}
    </div>
  );
}
