"use client";

import { useCallback, useEffect, useState } from "react";
import { calUrl, DEFAULT_QUESTIONS, fmtDuration, slugify, slugTyping, WEEKDAYS, type Question, type QuestionKind, type TimeRange, type WeeklyHours } from "@/lib/core";
import type { CalBooking, CalEventType, CalHost } from "@/lib/cal";
import type { CalendarInfo } from "@/lib/google";
import s from "../ui.module.css";

/**
 * /admin - every booking page on this deploy.
 *   Event types  what can be booked: length, notice, buffers, the questions asked.
 *   Bookings     upcoming and recent, with what each guest said; cancel from here.
 *   Hours        weekly hours in the host's zone, plus days off or special hours.
 *   Calendars    which calendars block time (any calendar shared with the host's Google
 *                account) and which one the meeting is written to.
 *   Page         name, link, zone, on/off.
 */

type Overview = {
  googleReady: boolean;
  hosts: { id: string; name: string; slug: string; email: string; active: boolean }[];
  host: CalHost | null;
  types: CalEventType[];
  bookings: CalBooking[];
};

type Tab = "types" | "bookings" | "hours" | "calendars" | "page";

const ERR: Record<string, string> = {
  slug_taken: "That link is already used. Pick another.",
  host_exists: "That person already has a page.",
  invalid_input: "Something in the form is not valid.",
  calendar_not_configured: "GOOGLE_SA_CLIENT_EMAIL and GOOGLE_SA_PRIVATE_KEY are not set on this deploy.",
  calendar_not_authorized: "Google Calendar is not authorized for the service account yet (domain-wide delegation scope).",
  calendar_user_unknown: "That email is not a user in your Google Workspace.",
  database_not_configured: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on this deploy.",
};
const say = (e: unknown) => ERR[(e as Error)?.message] ?? "That did not save. Try again.";

async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await r.json().catch(() => null);
  if (r.status === 401) {
    window.location.href = "/admin/login";
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(json?.error ?? "failed");
  return json as T;
}

const ZONES = ["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore"];
function allZones(current?: string | null): string[] {
  let list = ZONES;
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (all?.length) list = all;
  } catch {
    /* short list */
  }
  return current && !list.includes(current) ? [current, ...list] : list;
}

function ZoneSelect({ value, onChange, label }: { value: string; onChange: (z: string) => void; label?: string }) {
  const select = (
    <select className={s.select} aria-label={label ?? "Time zone"} value={value} onChange={(e) => onChange(e.target.value)}>
      {allZones(value).map((z) => (
        <option key={z} value={z}>
          {z}
        </option>
      ))}
    </select>
  );
  if (!label) return select;
  return (
    <label className={s.label} style={{ maxWidth: 360 }}>
      <span>{label}</span>
      {select}
    </label>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={`${s.card} ${s.modal}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className={s.title} style={{ fontSize: 20, marginBottom: 16 }}>
          {title}
        </h2>
        {children}
        {footer && <div style={{ marginTop: 20 }}>{footer}</div>}
      </div>
    </div>
  );
}

export function AdminApp() {
  const [pick, setPick] = useState<string | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("types");
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await api<Overview>(`/api/admin${pick ? `?host=${pick}` : ""}`));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(say(e));
    }
  }, [pick]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const host = data?.host ?? null;
  const signOut = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  };

  return (
    <main className={s.adminWrap}>
      <div className={s.bar}>
        <div>
          <div className={s.eyebrow}>open-cal</div>
          <h1 className={s.title}>Booking pages</h1>
        </div>
        <div className={s.row}>
          {data && data.hosts.length > 0 && (
            <select className={s.select} aria-label="Page" value={host?.id ?? ""} onChange={(e) => setPick(e.target.value || null)}>
              {data.hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.slug})
                </option>
              ))}
            </select>
          )}
          {data && data.hosts.length > 0 && (
            <button type="button" className={`${s.ghost} ${s.small}`} onClick={() => setAdding(true)}>
              New page
            </button>
          )}
          <button type="button" className={`${s.ghost} ${s.small}`} onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
      {loadErr && <p className={s.error}>{loadErr}</p>}
      {data && !data.googleReady && <div className={s.notice}>The Google service account is not set on this deploy, so no times can be offered yet.</div>}
      {!data && !loadErr && <p className={s.empty}>Loading…</p>}
      {data && !host && (
        <div className={`${s.card} ${s.panel}`}>
          <h3 className={s.h3}>Set up the first booking page</h3>
          <p className={s.hint}>Starts with Mon-Fri 09:00-17:00 and the person&apos;s own calendar. You can change all of it after.</p>
          <SetupForm onDone={(id) => setPick(id)} />
        </div>
      )}
      {data && host && (
        <>
          <LinkBar host={host} />
          <div className={s.tabs} role="tablist">
            {(
              [
                ["types", `Event types (${data.types.length})`],
                ["bookings", `Bookings (${data.bookings.filter((b) => b.status === "confirmed" && Date.parse(b.end_at) > Date.now()).length})`],
                ["hours", "Hours"],
                ["calendars", "Calendars"],
                ["page", "Page"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`${s.tab} ${tab === k ? s.tabOn : ""}`} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          {tab === "types" && <TypesTab host={host} types={data.types} onChange={reload} />}
          {tab === "bookings" && <BookingsTab host={host} types={data.types} bookings={data.bookings} onChange={reload} />}
          {tab === "hours" && <HoursTab key={host.id} host={host} onChange={reload} />}
          {tab === "calendars" && <CalendarsTab key={host.id} host={host} onChange={reload} />}
          {tab === "page" && (
            <PageTab
              key={host.id}
              host={host}
              onChange={reload}
              onDeleted={() => {
                setPick(null);
                void reload();
              }}
            />
          )}
        </>
      )}
      {adding && (
        <Modal title="New booking page" onClose={() => setAdding(false)}>
          <SetupForm
            onDone={(id) => {
              setAdding(false);
              setPick(id);
            }}
          />
        </Modal>
      )}
    </main>
  );
}

/* ── Setup ────────────────────────────────────────────────────────────────────────── */

function SetupForm({ onDone }: { onDone: (id: string) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [tz, setTz] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ host: CalHost }>("/api/admin", "POST", { email, name, slug: slugify(slug) || slugify(name), timezone: tz });
      onDone(r.host.id);
    } catch (e) {
      setErr(say(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.fields}>
      <label className={`${s.label} ${s.full}`}>
        <span>Google Workspace email</span>
        <input className={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} placeholder="you@yourcompany.com" />
        <span className={s.hint}>Bookings land on this person&apos;s calendar, with them as organizer.</span>
      </label>
      <label className={s.label}>
        <span>Name on the page</span>
        <input className={s.input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={s.label}>
        <span>Link</span>
        <input className={s.input} value={slug} maxLength={41} placeholder={slugify(name)} onChange={(e) => setSlug(slugTyping(e.target.value))} />
        <span className={s.hint}>{calUrl(slug || slugify(name) || "...").replace(/^https?:\/\//, "")}</span>
      </label>
      <label className={s.label}>
        <span>Time zone</span>
        <ZoneSelect value={tz} onChange={setTz} />
      </label>
      {err && <p className={`${s.error} ${s.full}`}>{err}</p>}
      <div className={s.full}>
        <button type="button" className={s.primary} disabled={busy || !email || !name || (slug || slugify(name)).length < 2} onClick={create}>
          {busy ? "Creating…" : "Create page"}
        </button>
      </div>
    </div>
  );
}

function LinkBar({ host }: { host: CalHost }) {
  const url = calUrl(host.slug);
  const [copied, setCopied] = useState(false);
  return (
    <div className={`${s.card} ${s.panel} ${s.row}`}>
      <span className={`${s.badge} ${host.active ? s.badgeOk : ""}`}>{host.active ? "Live" : "Off"}</span>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600 }}>
        {url.replace(/^https?:\/\//, "")}
      </a>
      <button
        type="button"
        className={`${s.ghost} ${s.small}`}
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span className={s.muted}>
        {host.email} · {host.timezone}
      </span>
    </div>
  );
}

/* ── Event types ──────────────────────────────────────────────────────────────────── */

function TypesTab({ host, types, onChange }: { host: CalHost; types: CalEventType[]; onChange: () => Promise<void> }) {
  const [edit, setEdit] = useState<CalEventType | "new" | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Copy an event with everything on it, then open the copy (it starts switched off).
  const duplicate = async (t: CalEventType) => {
    setCopying(t.id);
    setErr(null);
    try {
      const r = await api<{ type: CalEventType }>(`/api/admin/types/${t.id}/duplicate`, "POST", {});
      await onChange();
      setEdit(r.type);
    } catch (e) {
      setErr(say(e));
    } finally {
      setCopying(null);
    }
  };
  return (
    <div className={`${s.card} ${s.panel}`}>
      <div className={s.bar}>
        <h3 className={s.h3}>Event types</h3>
        <button type="button" className={`${s.primary} ${s.small}`} onClick={() => setEdit("new")}>
          New event type
        </button>
      </div>
      {err && <p className={s.error}>{err}</p>}
      {types.length === 0 ? (
        <p className={s.empty}>No event types yet. Add one, like a 15-minute intro call.</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Length</th>
                <th>Notice</th>
                <th>Status</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className={s.clickRow} onClick={() => setEdit(t)}>
                  <td>
                    <strong>{t.name}</strong>
                    <div className={s.muted}>/{t.slug}</div>
                  </td>
                  <td>{fmtDuration(t.duration_min)}</td>
                  <td>{fmtDuration(t.min_notice_min)}</td>
                  <td>
                    <span className={`${s.badge} ${t.active ? s.badgeOk : ""}`}>{t.active ? "On" : "Off"}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <span className={s.row}>
                      <a href={calUrl(host.slug, t.slug)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                        Open
                      </a>
                      <button type="button" className={`${s.ghost} ${s.small}`} disabled={copying === t.id} onClick={() => duplicate(t)}>
                        {copying === t.id ? "Copying…" : "Duplicate"}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <TypeEditor
          key={edit === "new" ? "new" : edit.id}
          host={host}
          type={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onDuplicate={(t) => void duplicate(t)}
          onSaved={async () => {
            setEdit(null);
            await onChange();
          }}
        />
      )}
    </div>
  );
}

const KIND_LABELS: Record<QuestionKind, string> = { text: "Short text", textarea: "Long text", url: "Link", phone: "Phone", select: "Pick one" };

function NumberField({ label, value, onChange, min, max, step, hint }: { label: string; value: number | null; onChange: (n: number | null) => void; min: number; max: number; step?: number; hint?: string }) {
  return (
    <label className={s.label}>
      <span>{label}</span>
      <input className={s.input} type="number" min={min} max={max} step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
      {hint && <span className={s.hint}>{hint}</span>}
    </label>
  );
}

function TypeEditor({
  host,
  type,
  onClose,
  onSaved,
  onDuplicate,
}: {
  host: CalHost;
  type: CalEventType | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDuplicate?: (t: CalEventType) => void;
}) {
  const [f, setF] = useState(() => ({
    name: type?.name ?? "",
    slug: type?.slug ?? "",
    description: type?.description ?? "",
    duration_min: type?.duration_min ?? 30,
    increment_min: type?.increment_min ?? 30,
    buffer_before_min: type?.buffer_before_min ?? 0,
    buffer_after_min: type?.buffer_after_min ?? 0,
    notice_h: (type?.min_notice_min ?? 1440) / 60,
    max_days_ahead: type?.max_days_ahead ?? 60,
    max_per_day: type?.max_per_day ?? null,
    extra: (type?.extra_attendees ?? []).join(", "),
    active: type?.active ?? true,
    questions: type?.questions ?? DEFAULT_QUESTIONS,
    allow_guests: type?.allow_guests !== false,
    extraBusy: (type?.extra_busy_calendar_ids ?? []).join(", "),
    own_hours: type?.weekly_hours != null,
    timezone: type?.timezone ?? host.timezone,
    weekly: (type?.weekly_hours ?? host.weekly_hours ?? {}) as WeeklyHours,
    overrides: (type?.date_overrides ?? {}) as Record<string, TimeRange[]>,
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (k: "duration_min" | "increment_min" | "buffer_before_min" | "buffer_after_min" | "notice_h" | "max_days_ahead") => (n: number | null) => set(k, n ?? 0);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const body = {
      name: f.name.trim(),
      slug: slugify(f.slug, 60) || slugify(f.name, 60),
      description: f.description,
      duration_min: Number(f.duration_min),
      increment_min: Number(f.increment_min),
      buffer_before_min: Number(f.buffer_before_min),
      buffer_after_min: Number(f.buffer_after_min),
      min_notice_min: Math.round(Number(f.notice_h) * 60),
      max_days_ahead: Number(f.max_days_ahead),
      max_per_day: f.max_per_day,
      extra_attendees: f.extra.split(/[\s,]+/).filter(Boolean),
      active: f.active,
      questions: f.questions.map((q) => ({ ...q, id: q.id || slugify(q.label, 30) || `q${Math.random().toString(36).slice(2, 6)}` })),
      allow_guests: f.allow_guests,
      extra_busy_calendar_ids: f.extraBusy.split(/[\s,]+/).filter(Boolean),
      // Own hours, or null to follow the page's hours.
      weekly_hours: f.own_hours ? cleanWeekly(f.weekly) : null,
      timezone: f.own_hours ? f.timezone : null,
      date_overrides: Object.keys(f.overrides).length ? f.overrides : null,
    };
    try {
      if (type) await api(`/api/admin/types/${type.id}`, "PATCH", body);
      else await api("/api/admin/types", "POST", { ...body, host_id: host.id });
      await onSaved();
    } catch (e) {
      setErr(say(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!type || !window.confirm(`Delete ${type.name}? Its link stops working. Past bookings stay.`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/types/${type.id}`, "DELETE");
      await onSaved();
    } catch (e) {
      setErr(say(e));
      setBusy(false);
    }
  };

  const setQ = (i: number, patch: Partial<Question>) => set("questions", f.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  return (
    <Modal
      title={type ? `Edit ${type.name}` : "New event type"}
      onClose={onClose}
      footer={
        <div className={s.bar} style={{ marginBottom: 0 }}>
          <div className={s.actions}>
            {type && (
              <button type="button" className={`${s.ghost} ${s.danger}`} onClick={remove} disabled={busy}>
                Delete
              </button>
            )}
            {type && onDuplicate && (
              <button type="button" className={s.ghost} onClick={() => onDuplicate(type)} disabled={busy}>
                Duplicate
              </button>
            )}
          </div>
          <div className={s.actions}>
            <button type="button" className={s.ghost} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={s.primary} disabled={busy || !f.name.trim()} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      <div className={s.fields}>
        <label className={s.label}>
          <span>Name</span>
          <input className={s.input} value={f.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="Intro call" />
        </label>
        <label className={s.label}>
          <span>Link</span>
          <input className={s.input} value={f.slug} maxLength={61} placeholder={slugify(f.name, 60)} onChange={(e) => set("slug", slugTyping(e.target.value, 60))} />
          <span className={s.hint}>{calUrl(host.slug, f.slug || slugify(f.name, 60) || "...").replace(/^https?:\/\//, "")}</span>
        </label>
        <label className={`${s.label} ${s.full}`}>
          <span>Description</span>
          <textarea className={s.textarea} value={f.description} maxLength={3000} onChange={(e) => set("description", e.target.value)} />
          <span className={s.hint}>Shown next to the calendar. Link a word like this: [our site](https://example.com). Plain https:// links work too.</span>
        </label>
        <NumberField label="Length (minutes)" min={5} max={480} value={f.duration_min} onChange={num("duration_min")} />
        <NumberField label="Start times every (minutes)" min={5} max={240} value={f.increment_min} onChange={num("increment_min")} hint="15-minute calls on a 30-minute grid start at :00 and :30." />
        <NumberField label="Minimum notice (hours)" min={0} max={720} step={0.5} value={f.notice_h} onChange={num("notice_h")} />
        <NumberField label="Bookable up to (days ahead)" min={1} max={365} value={f.max_days_ahead} onChange={num("max_days_ahead")} />
        <NumberField label="Buffer before (minutes)" min={0} max={240} value={f.buffer_before_min} onChange={num("buffer_before_min")} />
        <NumberField label="Buffer after (minutes)" min={0} max={240} value={f.buffer_after_min} onChange={num("buffer_after_min")} />
        <NumberField label="Most bookings a day" min={1} max={50} value={f.max_per_day} onChange={(n) => set("max_per_day", n)} hint="Empty for no limit." />
        <label className={s.label}>
          <span>Also check these calendars</span>
          <input className={s.input} value={f.extraBusy} onChange={(e) => set("extraBusy", e.target.value)} placeholder="teammate@yourcompany.com" />
          <span className={s.hint}>On top of the Calendars tab, for this event only (a teammate who must be free too).</span>
        </label>
        <label className={s.label}>
          <span>Also invite</span>
          <input className={s.input} value={f.extra} onChange={(e) => set("extra", e.target.value)} placeholder="teammate@yourcompany.com" />
          <span className={s.hint}>Emails, comma separated (someone who joins every call).</span>
        </label>
        <div className={`${s.row} ${s.full}`} style={{ gap: 24 }}>
          <label className={s.check2}>
            <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Bookable
          </label>
          <label className={s.check2}>
            <input type="checkbox" checked={f.allow_guests} onChange={(e) => set("allow_guests", e.target.checked)} /> Guests can add other people
          </label>
        </div>
      </div>

      <h3 className={s.h3} style={{ marginTop: 24 }}>
        Hours for this event
      </h3>
      <p className={s.hint}>Use the page&apos;s hours (the Hours tab), or give this event its own.</p>
      <div className={s.row}>
        <button type="button" className={`${s.tab} ${!f.own_hours ? s.tabOn : ""}`} onClick={() => set("own_hours", false)}>
          Page hours ({host.timezone})
        </button>
        <button type="button" className={`${s.tab} ${f.own_hours ? s.tabOn : ""}`} onClick={() => set("own_hours", true)}>
          Own hours
        </button>
      </div>
      {f.own_hours && (
        <div style={{ display: "grid", gap: 12, marginTop: 12, padding: 12, border: "1px solid var(--line)", borderRadius: 12 }}>
          <ZoneSelect value={f.timezone} onChange={(z) => set("timezone", z)} label="These hours are in" />
          <WeeklyEditor value={f.weekly} onChange={(w) => set("weekly", w)} />
        </div>
      )}
      <h3 className={s.h3} style={{ marginTop: 20 }}>
        Dates for this event only
      </h3>
      <p className={s.hint}>Close a day or set special hours just for this event. Days off on the Hours tab still apply.</p>
      <OverridesEditor value={f.overrides} onChange={(o) => set("overrides", o)} />

      <h3 className={s.h3} style={{ marginTop: 24 }}>
        Questions on the booking form
      </h3>
      <p className={s.hint}>Name and email are always asked and always required. Your questions come after; tick Required for the ones a guest must answer. Answers land in the booking, the invite and the host email.</p>
      <div style={{ display: "grid", gap: 8 }}>
        {f.questions.map((q, i) => (
          <div key={i} className={s.qRow}>
            <input className={s.input} aria-label="Question" value={q.label} maxLength={300} onChange={(e) => setQ(i, { label: e.target.value })} />
            <select
              className={s.select}
              aria-label="Kind"
              value={q.kind}
              onChange={(e) => setQ(i, { kind: e.target.value as QuestionKind, options: e.target.value === "select" ? (q.options ?? ["Option 1", "Option 2"]) : undefined })}
            >
              {(Object.keys(KIND_LABELS) as QuestionKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <label className={s.check2}>
              <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> Required
            </label>
            <button type="button" className={`${s.ghost} ${s.small}`} aria-label="Remove question" onClick={() => set("questions", f.questions.filter((_, j) => j !== i))}>
              Remove
            </button>
            {q.kind === "select" && (
              <label className={`${s.label} ${s.full}`}>
                <span>Options (one per line)</span>
                <textarea className={s.textarea} value={(q.options ?? []).join("\n")} onChange={(e) => setQ(i, { options: e.target.value.split("\n") })} />
              </label>
            )}
          </div>
        ))}
        {f.questions.length < 10 && (
          <div>
            <button type="button" className={`${s.ghost} ${s.small}`} onClick={() => set("questions", [...f.questions, { id: "", label: "", kind: "text", required: false }])}>
              Add question
            </button>
          </div>
        )}
      </div>
      {err && (
        <p className={s.error} style={{ marginTop: 12 }}>
          {err}
        </p>
      )}
    </Modal>
  );
}

/* ── Bookings ─────────────────────────────────────────────────────────────────────── */

function BookingsTab({ host, types, bookings, onChange }: { host: CalHost; types: CalEventType[]; bookings: CalBooking[]; onChange: () => Promise<void> }) {
  const [show, setShow] = useState<"upcoming" | "all">("upcoming");
  const [open, setOpen] = useState<CalBooking | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = Date.now();
  const rows = show === "upcoming" ? bookings.filter((b) => b.status === "confirmed" && Date.parse(b.end_at) > now) : [...bookings].reverse();
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: host.timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const cancelOne = async (b: CalBooking) => {
    if (!window.confirm(`Cancel ${b.guest_name}'s ${b.event_name}? Google emails them the cancellation.`)) return;
    try {
      await api(`/api/admin/bookings/${b.id}`, "DELETE", {});
      setOpen(null);
      await onChange();
    } catch (e) {
      setErr(say(e));
    }
  };

  const questions = (b: CalBooking) => types.find((t) => t.id === b.event_type_id)?.questions ?? DEFAULT_QUESTIONS;

  return (
    <div className={`${s.card} ${s.panel}`}>
      <div className={s.row} style={{ marginBottom: 12 }}>
        <button type="button" className={`${s.tab} ${show === "upcoming" ? s.tabOn : ""}`} onClick={() => setShow("upcoming")}>
          Upcoming
        </button>
        <button type="button" className={`${s.tab} ${show === "all" ? s.tabOn : ""}`} onClick={() => setShow("all")}>
          Last 30 days and ahead
        </button>
        <span className={s.muted}>Times in {host.timezone}</span>
      </div>
      {err && <p className={s.error}>{err}</p>}
      {rows.length === 0 ? (
        <p className={s.empty}>No bookings yet. Share your link and they will show up here.</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Guest</th>
                <th>Event</th>
                <th>Status</th>
                <th>Booked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const past = Date.parse(b.end_at) < now;
                return (
                  <tr key={b.id} className={s.clickRow} onClick={() => setOpen(b)}>
                    <td>{fmt(b.start_at)}</td>
                    <td>
                      <strong>{b.guest_name}</strong>
                      <div className={s.muted}>{b.guest_email}</div>
                    </td>
                    <td>{b.event_name}</td>
                    <td>
                      <span className={`${s.badge} ${b.status === "cancelled" ? s.badgeBad : past ? "" : s.badgeOk}`}>{b.status === "cancelled" ? "Cancelled" : past ? "Done" : "Upcoming"}</span>
                    </td>
                    <td>{b.created_at.slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Modal
          title={`${open.guest_name} - ${open.event_name}`}
          onClose={() => setOpen(null)}
          footer={
            open.status === "confirmed" && Date.parse(open.end_at) > now ? (
              <button type="button" className={`${s.ghost} ${s.danger}`} onClick={() => cancelOne(open)}>
                Cancel meeting
              </button>
            ) : null
          }
        >
          <dl className={s.dl}>
            <Row k="When">{fmt(open.start_at)}</Row>
            <Row k="Email">
              <a href={`mailto:${open.guest_email}`} style={{ color: "var(--accent)" }}>
                {open.guest_email}
              </a>
            </Row>
            {open.guest_timezone && <Row k="Their time zone">{open.guest_timezone}</Row>}
            {questions(open)
              .filter((q) => open.answers?.[q.id])
              .map((q) => (
                <Row key={q.id} k={q.label}>
                  {open.answers[q.id]}
                </Row>
              ))}
            {Object.entries(open.meta ?? {}).map(([k, v]) => (
              <Row key={k} k={k}>
                {v}
              </Row>
            ))}
            {open.meet_url && open.status === "confirmed" && (
              <Row k="Meet">
                <a href={open.meet_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                  {open.meet_url.replace("https://", "")}
                </a>
              </Row>
            )}
            {open.rescheduled_from && <Row k="Moved from">{fmt(open.rescheduled_from)}</Row>}
            {open.status === "cancelled" && (
              <Row k="Cancelled">
                {open.cancelled_by === "guest" ? "by the guest" : "by the host"}
                {open.cancel_reason ? `: ${open.cancel_reason}` : ""}
              </Row>
            )}
          </dl>
        </Modal>
      )}
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* ── Hours ────────────────────────────────────────────────────────────────────────── */

const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Drop closed days so a week saves as only its open days. */
const cleanWeekly = (w: WeeklyHours): WeeklyHours => Object.fromEntries(Object.entries(w).filter(([, r]) => r.length));

/** One week of hours, a row per day, up to 4 ranges a day. */
function WeeklyEditor({ value, onChange }: { value: WeeklyHours; onChange: (w: WeeklyHours) => void }) {
  const setDay = (d: number, ranges: TimeRange[]) => onChange({ ...value, [String(d)]: ranges });
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {ORDER.map((d) => {
        const ranges = value[String(d)] ?? [];
        return (
          <div key={d} className={s.row}>
            <label className={s.check2} style={{ width: 72 }}>
              <input type="checkbox" checked={ranges.length > 0} onChange={(e) => setDay(d, e.target.checked ? [{ start: "09:00", end: "17:00" }] : [])} />
              {WEEKDAYS[d]}
            </label>
            {ranges.length === 0 && <span className={s.muted}>Unavailable</span>}
            {ranges.map((r, i) => (
              <RangeInput key={i} value={r} onChange={(nr) => setDay(d, ranges.map((x, j) => (j === i ? nr : x)))} onRemove={() => setDay(d, ranges.filter((_, j) => j !== i))} />
            ))}
            {ranges.length > 0 && ranges.length < 4 && (
              <button type="button" className={`${s.ghost} ${s.small}`} aria-label={`Add hours on ${WEEKDAYS[d]}`} onClick={() => setDay(d, [...ranges, { start: "14:00", end: "17:00" }])}>
                +
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Date overrides: a date with no hours is closed, a date with hours replaces its weekday. */
function OverridesEditor({ value, onChange }: { value: Record<string, TimeRange[]>; onChange: (o: Record<string, TimeRange[]>) => void }) {
  const [newDate, setNewDate] = useState("");
  const setDate = (date: string, ranges: TimeRange[]) => onChange({ ...value, [date]: ranges });
  return (
    <>
      <div className={s.row} style={{ marginBottom: 12 }}>
        <input className={s.input} style={{ width: "auto" }} type="date" aria-label="Date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        <button
          type="button"
          className={`${s.ghost} ${s.small}`}
          disabled={!newDate || newDate in value}
          onClick={() => {
            setDate(newDate, []);
            setNewDate("");
          }}
        >
          Add date
        </button>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {Object.keys(value)
          .sort()
          .map((date) => (
            <div key={date} className={s.row}>
              <span style={{ width: 96, fontVariantNumeric: "tabular-nums" }}>{date}</span>
              {value[date].length === 0 && <span className={s.badge}>Closed</span>}
              {value[date].map((r, i) => (
                <RangeInput
                  key={i}
                  value={r}
                  onChange={(nr) => setDate(date, value[date].map((x, j) => (j === i ? nr : x)))}
                  onRemove={() => setDate(date, value[date].filter((_, j) => j !== i))}
                />
              ))}
              <button type="button" className={`${s.ghost} ${s.small}`} aria-label={`Add hours on ${date}`} onClick={() => setDate(date, [...value[date], { start: "09:00", end: "12:00" }])}>
                +
              </button>
              <button
                type="button"
                className={`${s.ghost} ${s.small}`}
                aria-label={`Remove ${date}`}
                onClick={() => {
                  const n = { ...value };
                  delete n[date];
                  onChange(n);
                }}
              >
                Remove
              </button>
            </div>
          ))}
        {Object.keys(value).length === 0 && <span className={s.muted}>None.</span>}
      </div>
    </>
  );
}

function HoursTab({ host, onChange }: { host: CalHost; onChange: () => Promise<void> }) {
  const [timezone, setTimezone] = useState(host.timezone);
  const [weekly, setWeekly] = useState<WeeklyHours>(host.weekly_hours ?? {});
  const [overrides, setOverrides] = useState<Record<string, TimeRange[]>>(host.date_overrides ?? {});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/admin/hosts/${host.id}`, "PATCH", { timezone, weekly_hours: cleanWeekly(weekly), date_overrides: overrides });
      setMsg("Hours saved.");
      await onChange();
    } catch (e) {
      setMsg(say(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${s.card} ${s.panel}`}>
      <div className={s.fields}>
        <div>
          <h3 className={s.h3}>Weekly hours</h3>
          <p className={s.hint}>The default for every event type. An event can keep its own hours instead (edit it under Event types). Guests always see times in their own zone.</p>
          <div style={{ marginBottom: 16 }}>
            <ZoneSelect value={timezone} onChange={setTimezone} label="Your time zone" />
          </div>
          <WeeklyEditor value={weekly} onChange={setWeekly} />
        </div>
        <div>
          <h3 className={s.h3}>Days off and special hours</h3>
          <p className={s.hint}>For every event type. A date here replaces its weekday; no hours means closed that day.</p>
          <OverridesEditor value={overrides} onChange={setOverrides} />
        </div>
      </div>
      <div className={s.actions} style={{ marginTop: 20 }}>
        <button type="button" className={s.primary} disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save hours"}
        </button>
        {msg && <span className={s.muted}>{msg}</span>}
      </div>
    </div>
  );
}

function RangeInput({ value, onChange, onRemove }: { value: TimeRange; onChange: (r: TimeRange) => void; onRemove: () => void }) {
  return (
    <span className={s.row} style={{ gap: 4 }}>
      <input className={`${s.input} ${s.time}`} type="time" step={900} value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} aria-label="From" />
      <span className={s.muted}>-</span>
      <input className={`${s.input} ${s.time}`} type="time" step={900} value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} aria-label="To" />
      <button type="button" className={`${s.ghost} ${s.small}`} aria-label="Remove these hours" onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

/* ── Calendars ────────────────────────────────────────────────────────────────────── */

function CalendarsTab({ host, onChange }: { host: CalHost; onChange: () => Promise<void> }) {
  const [data, setData] = useState<{ calendars: CalendarInfo[]; errors: Record<string, string> } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>(host.busy_calendar_ids);
  const [target, setTarget] = useState<string>(host.target_calendar_id ?? host.email);
  const [extra, setExtra] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoadErr(null);
    try {
      setData(await api(`/api/admin/hosts/${host.id}/calendars`));
    } catch (e) {
      setLoadErr(say(e));
    }
  }, [host.id]);
  useEffect(() => {
    void check();
  }, [check]);

  const listed = data?.calendars ?? [];
  const ids = [...new Set([...listed.map((c) => c.id), ...busyIds])];
  const nameOf = (id: string) => listed.find((c) => c.id === id)?.summary ?? id;
  const writable = listed.filter((c) => c.accessRole === "owner" || c.accessRole === "writer");

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api(`/api/admin/hosts/${host.id}`, "PATCH", { busy_calendar_ids: busyIds, target_calendar_id: target === host.email ? null : target });
      setMsg("Calendars saved.");
      await onChange();
      await check();
    } catch (e) {
      setMsg(say(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${s.card} ${s.panel}`}>
      <h3 className={s.h3}>Calendars that block time</h3>
      <p className={s.hint}>
        Any calendar {host.email} can see. To add a calendar from another account (a personal Gmail, another workspace), share it with {host.email} with at least
        &quot;See only free/busy&quot;, then add its address below.
      </p>
      {loadErr && <p className={s.error}>{loadErr}</p>}
      {!data && !loadErr ? (
        <p className={s.empty}>Checking calendars…</p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {ids.map((id) => {
            const on = busyIds.includes(id);
            const problem = data?.errors?.[id];
            return (
              <div key={id} className={s.row}>
                <label className={s.check2}>
                  <input type="checkbox" checked={on} onChange={(e) => setBusyIds((b) => (e.target.checked ? [...b, id] : b.filter((x) => x !== id)))} />
                  {nameOf(id)}
                </label>
                {nameOf(id) !== id && <span className={s.muted}>{id}</span>}
                {on && problem && <span className={`${s.badge} ${s.badgeBad}`}>Cannot read ({problem})</span>}
                {on && !problem && data && <span className={`${s.badge} ${s.badgeOk}`}>Checked</span>}
              </div>
            );
          })}
        </div>
      )}
      <div className={s.row} style={{ marginTop: 12 }}>
        <input className={s.input} style={{ maxWidth: 320 }} aria-label="Add a calendar by address" value={extra} onChange={(e) => setExtra(e.target.value.trim())} placeholder="name@gmail.com" />
        <button
          type="button"
          className={`${s.ghost} ${s.small}`}
          disabled={!extra || busyIds.includes(extra)}
          onClick={() => {
            setBusyIds((b) => [...b, extra]);
            setExtra("");
          }}
        >
          Add
        </button>
      </div>

      <h3 className={s.h3} style={{ marginTop: 24 }}>
        Write bookings to
      </h3>
      <select className={s.select} style={{ maxWidth: 420 }} aria-label="Calendar" value={target} onChange={(e) => setTarget(e.target.value)}>
        {[host.email, ...writable.map((c) => c.id).filter((id) => id !== host.email)].map((id) => (
          <option key={id} value={id}>
            {id === host.email ? `${host.email} (primary)` : nameOf(id)}
          </option>
        ))}
      </select>
      <div className={s.actions} style={{ marginTop: 20 }}>
        <button type="button" className={s.primary} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save calendars"}
        </button>
        <button type="button" className={s.ghost} onClick={check}>
          Check again
        </button>
        {msg && <span className={s.muted}>{msg}</span>}
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────────────── */

function PageTab({ host, onChange, onDeleted }: { host: CalHost; onChange: () => Promise<void>; onDeleted: () => void }) {
  const [f, setF] = useState({ name: host.name, slug: host.slug, headline: host.headline ?? "", bio: host.bio ?? "", avatar_url: host.avatar_url ?? "", active: host.active });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/admin/hosts/${host.id}`, "PATCH", { ...f, slug: slugify(f.slug) });
      setMsg("Page saved.");
      await onChange();
    } catch (e) {
      setMsg(say(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${host.name}'s page? The link, event types and booking history go. Meetings already on calendars stay.`)) return;
    try {
      await api(`/api/admin/hosts/${host.id}`, "DELETE");
      onDeleted();
    } catch (e) {
      setMsg(say(e));
    }
  };

  return (
    <div className={`${s.card} ${s.panel}`}>
      <div className={s.fields}>
        <label className={s.label}>
          <span>Name</span>
          <input className={s.input} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className={s.label}>
          <span>Link</span>
          <input className={s.input} value={f.slug} maxLength={41} onChange={(e) => setF({ ...f, slug: slugTyping(e.target.value) })} />
          <span className={s.hint}>{calUrl(f.slug || "...").replace(/^https?:\/\//, "")}</span>
        </label>
        <label className={`${s.label} ${s.full}`}>
          <span>One line under your name</span>
          <input className={s.input} value={f.headline} maxLength={200} onChange={(e) => setF({ ...f, headline: e.target.value })} placeholder="Founder, Acme" />
        </label>
        <label className={`${s.label} ${s.full}`}>
          <span>About you</span>
          <textarea className={s.textarea} value={f.bio} maxLength={1500} onChange={(e) => setF({ ...f, bio: e.target.value })} />
          <span className={s.hint}>A few lines on your page. Link a word like this: [my site](https://example.com).</span>
        </label>
        <label className={`${s.label} ${s.full}`}>
          <span>Photo URL</span>
          <input className={s.input} value={f.avatar_url} maxLength={500} onChange={(e) => setF({ ...f, avatar_url: e.target.value })} />
          <span className={s.hint}>A public https link to a square image. Empty shows your initial.</span>
        </label>
        <label className={`${s.check2} ${s.full}`}>
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Page is live
        </label>
      </div>
      <div className={s.bar} style={{ marginTop: 20, marginBottom: 0 }}>
        <div className={s.actions}>
          <button type="button" className={s.primary} disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save page"}
          </button>
          {msg && <span className={s.muted}>{msg}</span>}
        </div>
        <button type="button" className={`${s.ghost} ${s.danger}`} onClick={remove}>
          Delete page
        </button>
      </div>
    </div>
  );
}
