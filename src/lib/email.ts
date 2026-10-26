/**
 * email.ts - what open-cal writes into inboxes. Pure, no IO, unit tested.
 *
 *   inviteTitle / inviteDescription  the Google Calendar event the guest and host receive. Google
 *                                     renders a small HTML subset in descriptions (b, br, a), so
 *                                     each answer reads as a bold label over its text.
 *   hostEmail                         the note to the host on a new, moved or cancelled booking:
 *                                     an HTML card (when, who, Join button, answers, source) with
 *                                     a plain-text twin for clients that block HTML.
 * Everything a guest typed is escaped before it goes into HTML.
 */

export type EmailQuestion = { id: string; label: string };

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Newlines in a guest's answer as <br>, after escaping. */
const multiline = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

/** "Podcast recording · Ana x Ada Lovelace": the event first, so a calendar day reads at a glance. */
export function inviteTitle(guest: string, host: string, event: string): string {
  return `${event} · ${guest} x ${host}`;
}

export function inviteDescription(o: { event: string; host: string; questions: EmailQuestion[]; answers: Record<string, string>; manageUrl: string; siteUrl: string }): string {
  const parts = [`<b>${esc(o.event)}</b> with ${esc(o.host)}`];
  const qa = o.questions.filter((q) => o.answers[q.id]);
  if (qa.length) parts.push(qa.map((q) => `<b>${esc(q.label)}</b><br>${multiline(o.answers[q.id])}`).join("<br><br>"));
  parts.push(`Need to move or cancel? <a href="${esc(o.manageUrl)}">Reschedule or cancel here</a>`);
  parts.push(`<i>Booked on <a href="${esc(o.siteUrl)}">${esc(o.siteUrl.replace(/^https?:\/\//, ""))}</a></i>`);
  return parts.join("<br><br>");
}

export type HostEmailInput = {
  kind: "new" | "moved" | "cancelled";
  event: string;
  hostTimezone: string;
  start: string;
  end: string;
  guestName: string;
  guestEmail: string;
  guestTimezone: string | null;
  questions: EmailQuestion[];
  answers: Record<string, string>;
  meta: Record<string, string>;
  meetUrl: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  movedFrom: string | null;
  /** Where "All bookings" points: this deploy's /admin. */
  adminUrl: string;
};

const HEAD = { new: "New booking", moved: "Booking moved", cancelled: "Booking cancelled" } as const;
const TONE = { new: "#16a34a", moved: "#d97706", cancelled: "#dc2626" } as const;

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }).format(new Date(iso));
}

/** "Tue 24 Nov, 20:00 - 20:45" in a zone. */
export function whenLine(start: string, end: string, tz: string): string {
  const day = fmt(start, tz, { weekday: "short", day: "numeric", month: "short" });
  const t = (x: string) => fmt(x, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${day}, ${t(start)} - ${t(end)}`;
}

const zoneName = (tz: string) => tz.replace(/_/g, " ");

export function hostEmail(i: HostEmailInput): { subject: string; text: string; html: string } {
  const head = HEAD[i.kind];
  const subject = `${head}: ${i.guestName} · ${i.event}`;
  const hostWhen = `${whenLine(i.start, i.end, i.hostTimezone)} (${zoneName(i.hostTimezone)})`;
  const guestWhen =
    i.guestTimezone && i.guestTimezone !== i.hostTimezone ? `${whenLine(i.start, i.end, i.guestTimezone)} for them (${zoneName(i.guestTimezone)})` : null;
  const qa = i.questions.filter((q) => i.answers[q.id]);
  const source = Object.entries(i.meta ?? {}).filter(([, v]) => v);
  const movedFrom = i.kind === "moved" && i.movedFrom ? `Was ${whenLine(i.movedFrom, i.movedFrom, i.hostTimezone).split(" - ")[0]}` : null;
  const reason = i.kind === "cancelled" ? [i.cancelledBy === "guest" ? "Cancelled by the guest" : i.cancelledBy ? `Cancelled by ${i.cancelledBy}` : null, i.cancelReason].filter(Boolean) : [];

  // Plain text twin.
  const text = [
    `${head}: ${i.event}`,
    "",
    hostWhen,
    ...(guestWhen ? [guestWhen] : []),
    ...(movedFrom ? [movedFrom] : []),
    "",
    `${i.guestName} <${i.guestEmail}>`,
    ...(i.meetUrl && i.kind !== "cancelled" ? ["", `Join: ${i.meetUrl}`] : []),
    ...(reason.length ? ["", ...reason.map(String)] : []),
    ...qa.flatMap((q) => ["", q.label, i.answers[q.id]]),
    ...(source.length ? ["", `Source: ${source.map(([k, v]) => `${k}=${v}`).join(", ")}`] : []),
    "",
    `All bookings: ${i.adminUrl}`,
  ].join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:14px 0 0"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8a8580;margin-bottom:4px">${esc(label)}</div><div style="font-size:15px;line-height:1.55;color:#1c1917">${value}</div></td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f3f1">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f1;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ebe6e1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<tr><td style="background:#0b0b0d;padding:16px 24px;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#ff8a65">open-cal</td></tr>
<tr><td style="padding:24px 24px 4px">
<div style="display:inline-block;font-size:12px;font-weight:700;color:#fff;background:${TONE[i.kind]};border-radius:999px;padding:4px 10px">${esc(head)}</div>
<div style="font-size:22px;line-height:1.3;font-weight:700;color:#1c1917;margin-top:12px">${esc(i.event)}</div>
<div style="font-size:16px;color:#1c1917;margin-top:8px"><b>${esc(hostWhen)}</b></div>
${guestWhen ? `<div style="font-size:14px;color:#57534e;margin-top:2px">${esc(guestWhen)}</div>` : ""}
${movedFrom ? `<div style="font-size:14px;color:#57534e;margin-top:2px;text-decoration:line-through">${esc(movedFrom)}</div>` : ""}
</td></tr>
<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("Guest", `${esc(i.guestName)} · <a href="mailto:${esc(i.guestEmail)}" style="color:#c2410c">${esc(i.guestEmail)}</a>`)}
${reason.length ? row("Cancellation", reason.map((r) => multiline(String(r))).join("<br>")) : ""}
${qa.map((q) => row(q.label, multiline(i.answers[q.id]))).join("")}
${source.length ? row("Came from", esc(source.map(([k, v]) => `${k}: ${v}`).join(" · "))) : ""}
</table></td></tr>
<tr><td style="padding:22px 24px 26px">
${
  i.meetUrl && i.kind !== "cancelled"
    ? `<a href="${esc(i.meetUrl)}" style="display:inline-block;background:#ff8a65;color:#0b0b0d;font-weight:700;font-size:14px;text-decoration:none;border-radius:999px;padding:11px 20px;margin-right:8px">Join Google Meet</a>`
    : ""
}<a href="${esc(i.adminUrl)}" style="display:inline-block;color:#1c1917;font-weight:600;font-size:14px;text-decoration:none;border:1px solid #d6d3d1;border-radius:999px;padding:10px 18px">All bookings</a>
<div style="font-size:12px;color:#8a8580;margin-top:16px">Reply to this email to write to ${esc(i.guestName)}.</div>
</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
