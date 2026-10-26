"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, fmtDuration, localDate, type Question } from "@/lib/core";
import type { PublicEventType, PublicHost } from "@/lib/cal";
import { RichText } from "./RichText";
import s from "./ui.module.css";

/**
 * The booking widget: month grid -> times -> details -> booked. Every time shows in the
 * guest's own zone (detected, changeable); the server only ever deals in UTC instants and the
 * host's zone. With `reschedule` it picks a new time for an existing booking instead.
 */

type Props = {
  host: PublicHost;
  type: PublicEventType;
  /** Rescheduling an existing booking (the guest's manage link). */
  reschedule?: { token: string; currentStart: string };
  /** Every open start (ISO) over the whole booking window, read on the server with the page, so
   * the calendar paints with its times and month changes need no request. Absent: fetch per month. */
  initialSlots?: string[];
};

type Booked = { start: string; end: string; event: string; host: string; meet_url: string | null; manage_url: string; email: string };

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FALLBACK_ZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "Europe/Madrid", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"];

const ERRORS: Record<string, string> = {
  slot_taken: "That time was just taken. Please pick another.",
  too_many_bookings: "Too many bookings from this network just now. Please try again in an hour.",
  email_invalid: "Please enter a valid email.",
  name_required: "Please enter your name.",
  guests_invalid: "One of the guest emails does not look right (up to 10).",
  not_found: "This booking page is not available anymore.",
  booking_cancelled: "This booking was cancelled.",
  booking_past: "This meeting has already happened.",
};

function guessZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function zones(current: string): string[] {
  let list: string[] = FALLBACK_ZONES;
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (all?.length) list = all;
  } catch {
    /* older browsers keep the short list */
  }
  return list.includes(current) ? list : [current, ...list];
}

const monthOf = (date: string) => date.slice(0, 7);
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function errorText(code: string, questions: Question[]): string {
  if (ERRORS[code]) return ERRORS[code];
  const [kind, id] = code.split(":");
  const q = questions.find((x) => x.id === id);
  if (kind === "answer_required" && q) return `Please answer: ${q.label}`;
  if (kind === "answer_too_long" && q) return `That answer is too long: ${q.label}`;
  return "Something went wrong. Please try again.";
}

export function Booker({ host, type, reschedule, initialSlots }: Props) {
  const [tz, setTz] = useState("UTC");
  const [h24, setH24] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setTz(guessZone());
    try {
      setH24(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle?.startsWith("h2") ?? false);
    } catch {
      /* keep 12h */
    }
    setReady(true);
  }, []);

  const todayGuest = useMemo(() => localDate(Date.now(), tz), [tz]);
  const [month, setMonth] = useState<string | null>(null);
  const shownMonth = month ?? monthOf(todayGuest);
  const lastMonth = monthOf(addDays(todayGuest, type.max_days_ahead + 1));

  // `all` = the server's full window (no requests while it holds); `fetched` = the per-month
  // fallback when it is missing or was dropped after a slot was taken.
  const [all, setAll] = useState<string[] | null>(initialSlots ?? null);
  const [fetched, setFetched] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [autoAdvanced, setAutoAdvanced] = useState(false);
  const [reload, setReload] = useState(0);

  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "form" | "done">("pick");
  const [booked, setBooked] = useState<Booked | null>(null);

  const slots = useMemo(() => {
    if (!all) return fetched;
    const byDay: Record<string, string[]> = {};
    for (const iso of all) {
      const d = localDate(Date.parse(iso), tz);
      if (monthOf(d) === shownMonth) (byDay[d] ??= []).push(iso);
    }
    return byDay;
  }, [all, fetched, tz, shownMonth]);

  // A month with nothing left (late in the month) moves on once by itself.
  useEffect(() => {
    if (!ready || !all || autoAdvanced || month !== null) return;
    if (Object.keys(slots).length === 0 && shownMonth < lastMonth && all.length > 0) {
      setAutoAdvanced(true);
      setMonth(shiftMonth(shownMonth, 1));
    }
  }, [ready, all, slots, autoAdvanced, month, shownMonth, lastMonth]);

  // Fallback: times for the shown month in the guest's zone. Host-local dates can be a day either side.
  useEffect(() => {
    if (!ready || all) return;
    const ctrl = new AbortController();
    const first = `${shownMonth}-01`;
    const last = `${shownMonth}-${String(daysInMonth(shownMonth)).padStart(2, "0")}`;
    const todayHost = localDate(Date.now(), type.timezone);
    const from = addDays(first, -1) < todayHost ? todayHost : addDays(first, -1);
    const horizon = addDays(todayHost, type.max_days_ahead + 1);
    const to = addDays(last, 1) > horizon ? horizon : addDays(last, 1);
    if (from > to) {
      setFetched({});
      return;
    }
    setLoading(true);
    setLoadErr(null);
    const q = new URLSearchParams({ host: host.slug, type: type.slug, from, to });
    if (reschedule) q.set("token", reschedule.token);
    fetch(`/api/public/slots?${q}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? "load_failed");
        const byDay: Record<string, string[]> = {};
        for (const iso of body.slots as string[]) {
          const d = localDate(Date.parse(iso), tz);
          if (monthOf(d) !== shownMonth) continue;
          (byDay[d] ??= []).push(iso);
        }
        setFetched(byDay);
        // A month with nothing left (late in the month) moves on once by itself.
        if (!autoAdvanced && month === null && Object.keys(byDay).length === 0 && shownMonth < lastMonth) {
          setAutoAdvanced(true);
          setMonth(shiftMonth(shownMonth, 1));
        }
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setLoadErr("Could not load times. Please refresh.");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, all, shownMonth, tz, reload, host.slug, type.slug, type.timezone]);

  const fmtTime = (iso: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: !h24 }).format(new Date(iso));
  const fmtDay = (date: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  const fmtFull = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: !h24 }).format(new Date(iso));

  const cells = useMemo(() => {
    const first = `${shownMonth}-01`;
    const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let i = 0; i < daysInMonth(shownMonth); i++) out.push(addDays(first, i));
    return out;
  }, [shownMonth]);

  const monthLabel = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${shownMonth}-15T12:00:00Z`));
  const daySlots = day ? (slots[day] ?? []) : [];

  const pickSlot = (iso: string) => {
    setSlot(iso);
    setStep("form");
  };

  if (step === "done" && slot) return <DoneView reschedule={!!reschedule} slotLabel={fmtFull(slot)} tz={tz} booked={booked} />;

  return (
    <div className={`${s.card} ${s.booker}`}>
      <aside className={s.info}>
        <div className={s.hostRow}>
          {host.avatar_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={s.avatarSm} src={host.avatar_url} alt="" />
          )}
          <div className={s.eyebrow}>{host.name}</div>
        </div>
        <h2 className={s.title}>{type.name}</h2>
        <ul className={s.facts}>
          <li>
            <strong>{fmtDuration(type.duration_min)}</strong>
          </li>
          <li>Google Meet, link in your invite</li>
          {slot && (
            <li>
              <strong>{fmtFull(slot)}</strong>
            </li>
          )}
          {reschedule && <li>Now: {fmtFull(reschedule.currentStart)}</li>}
        </ul>
        {type.description && (
          <p className={`${s.sub} ${s.rich}`}>
            <RichText text={type.description} />
          </p>
        )}

      </aside>

      {step === "pick" ? (
        <div className={s.picker}>
          <div>
            <div className={s.monthHead}>
              <button type="button" className={s.navBtn} aria-label="Previous month" disabled={shownMonth <= monthOf(todayGuest)} onClick={() => setMonth(shiftMonth(shownMonth, -1))}>
                ‹
              </button>
              <span>{monthLabel}</span>
              <button type="button" className={s.navBtn} aria-label="Next month" disabled={shownMonth >= lastMonth} onClick={() => setMonth(shiftMonth(shownMonth, 1))}>
                ›
              </button>
            </div>
            <div className={s.grid} aria-busy={loading}>
              {DOW.map((d) => (
                <div key={d} className={s.dow}>
                  {d}
                </div>
              ))}
              {cells.map((d, i) =>
                d ? (
                  <button
                    type="button"
                    key={d}
                    className={[s.day, slots[d]?.length ? s.dayOpen : "", day === d ? s.daySel : "", d === todayGuest ? s.today : ""].join(" ")}
                    disabled={!slots[d]?.length}
                    aria-pressed={day === d}
                    aria-label={`${fmtDay(d)}${slots[d]?.length ? `, ${slots[d].length} times` : ", no times"}`}
                    onClick={() => setDay(d)}
                  >
                    {Number(d.slice(8))}
                  </button>
                ) : (
                  <span key={`pad-${i}`} />
                ),
              )}
            </div>
            <div className={s.tzRow}>
              <label>
                <span className="sr-only">Time zone</span>
                <select className={s.select} value={tz} onChange={(e) => setTz(e.target.value)}>
                  {zones(tz).map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <span className={s.toggle} role="group" aria-label="Clock">
                <button type="button" className={!h24 ? s.on : ""} aria-pressed={!h24} onClick={() => setH24(false)}>
                  am/pm
                </button>
                <button type="button" className={h24 ? s.on : ""} aria-pressed={h24} onClick={() => setH24(true)}>
                  24h
                </button>
              </span>
            </div>
          </div>
          <div>
            <div className={s.slotsHead}>{day ? fmtDay(day) : "Pick a day"}</div>
            {loadErr ? (
              <p className={s.error}>{loadErr}</p>
            ) : loading && !Object.keys(slots).length ? (
              <p className={s.empty}>Loading times…</p>
            ) : day ? (
              <div className={s.slots}>
                {daySlots.map((iso) => (
                  <button type="button" key={iso} className={s.slot} onClick={() => pickSlot(iso)}>
                    {fmtTime(iso)}
                  </button>
                ))}
              </div>
            ) : (
              <p className={s.empty}>{Object.keys(slots).length ? "Highlighted days have open times." : "No open times this month. Try the next one."}</p>
            )}
          </div>
        </div>
      ) : (
        <DetailsForm
          host={host}
          type={type}
          slot={slot!}
          tz={tz}
          slotLabel={fmtFull(slot!)}
          reschedule={reschedule}
          onBack={() => setStep("pick")}
          onTaken={() => {
            setStep("pick");
            setSlot(null);
            // The server's copy is stale now: read live times month by month from here on.
            setAll(null);
            setReload((n) => n + 1);
          }}
          onBooked={(b) => {
            setBooked(b);
            setStep("done");
          }}
        />
      )}
    </div>
  );
}

function DetailsForm({
  host,
  type,
  slot,
  tz,
  slotLabel,
  reschedule,
  onBack,
  onTaken,
  onBooked,
}: {
  host: PublicHost;
  type: PublicEventType;
  slot: string;
  tz: string;
  slotLabel: string;
  reschedule?: Props["reschedule"];
  onBack: () => void;
  onTaken: () => void;
  onBooked: (b: Booked | null) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showGuests, setShowGuests] = useState(false);
  const [guests, setGuests] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (reschedule) {
        const r = await fetch("/api/public/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: reschedule.token, action: "reschedule", start: slot }),
        });
        const body = await r.json().catch(() => null);
        if (!r.ok) {
          if (body?.error === "slot_taken") return onTaken();
          throw new Error(body?.error ?? "failed");
        }
        return onBooked(null);
      }
      const meta: Record<string, string> = {};
      const q = new URLSearchParams(window.location.search);
      for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"]) {
        const v = q.get(k);
        if (v) meta[k] = v;
      }
      if (document.referrer && !document.referrer.includes(window.location.host)) meta.referrer = document.referrer;
      const r = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: host.slug, type: type.slug, start: slot, name, email, guests, answers, timezone: tz, meta, company_url: hp }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        if (body?.error === "slot_taken") {
          setErr(ERRORS.slot_taken);
          setTimeout(onTaken, 1500);
          return;
        }
        throw new Error(body?.error ?? "failed");
      }
      onBooked((body?.booking as Booked) ?? null);
    } catch (e2) {
      setErr(errorText((e2 as Error).message, type.questions));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={s.form} onSubmit={submit}>
      <div className={s.chosen}>{slotLabel}</div>
      {!reschedule && (
        <>
          <label className={s.label}>
            <span>
              Your name <span className={s.req}>*</span>
            </span>
            <input className={s.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
          </label>
          <label className={s.label}>
            <span>
              Email <span className={s.req}>*</span>
            </span>
            <input className={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
          </label>
          {!type.allow_guests ? null : showGuests ? (
            <label className={s.label}>
              <span>Guest emails</span>
              <textarea
                className={s.textarea}
                style={{ minHeight: 64 }}
                value={guests}
                maxLength={1000}
                placeholder="Separate emails with commas"
                onChange={(e) => setGuests(e.target.value)}
              />
            </label>
          ) : (
            <div>
              <button type="button" className={s.ghost} onClick={() => setShowGuests(true)}>
                Add guests
              </button>
            </div>
          )}
          {type.questions.map((q) => (
            <label key={q.id} className={s.label}>
              <span>
                {q.label} {q.required && <span className={s.req}>*</span>}
              </span>
              {q.kind === "textarea" ? (
                <textarea className={s.textarea} value={answers[q.id] ?? ""} required={q.required} maxLength={3000} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
              ) : q.kind === "select" ? (
                <select className={`${s.input}`} value={answers[q.id] ?? ""} required={q.required} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}>
                  <option value="">Choose one</option>
                  {q.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={s.input}
                  type={q.kind === "url" ? "text" : q.kind === "phone" ? "tel" : "text"}
                  inputMode={q.kind === "url" ? "url" : undefined}
                  placeholder={q.kind === "url" ? "example.com" : undefined}
                  autoComplete={q.kind === "phone" ? "tel" : q.id === "company" ? "organization" : q.id === "role" ? "organization-title" : undefined}
                  value={answers[q.id] ?? ""}
                  required={q.required}
                  maxLength={500}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                />
              )}
            </label>
          ))}
          <div className={s.hp} aria-hidden="true">
            <label>
              Company URL
              <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
            </label>
          </div>
        </>
      )}
      {err && (
        <p className={s.error} role="alert">
          {err}
        </p>
      )}
      <div className={s.actions}>
        <button type="submit" className={s.primary} disabled={busy}>
          {busy ? "One moment…" : reschedule ? "Move my meeting" : "Book it"}
        </button>
        <button type="button" className={s.ghost} onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
    </form>
  );
}

function DoneView({ reschedule, slotLabel, tz, booked: b }: { reschedule: boolean; slotLabel: string; tz: string; booked: Booked | null }) {
  return (
    <div className={`${s.card} ${s.done}`}>
      <div className={s.check} aria-hidden="true">
        ✓
      </div>
      <div className={s.eyebrow}>{reschedule ? "Moved" : "You're booked"}</div>
      <h2 className={s.title}>{slotLabel}</h2>
      <p className={s.sub}>{tz.replace(/_/g, " ")}</p>
      <div className={s.doneFacts}>
        {b && (
          <>
            <div>
              <strong>{b.event}</strong> with {b.host}
            </div>
            <div>
              A calendar invite is on its way to <strong>{b.email}</strong> with the Google Meet link.
            </div>
            {b.meet_url && (
              <div>
                Meet:{" "}
                <a href={b.meet_url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                  {b.meet_url.replace(/^https:\/\//, "")}
                </a>
              </div>
            )}
            <div>
              Need to change it?{" "}
              <a href={b.manage_url} style={{ color: "inherit" }}>
                Reschedule or cancel
              </a>
            </div>
          </>
        )}
        {!b && <div>Everyone on the invite has been sent the new time.</div>}
      </div>
    </div>
  );
}
