import { describe, expect, it } from "vitest";
import { esc, hostEmail, inviteDescription, inviteTitle, whenLine } from "./email";

describe("emails", () => {
  it("titles lead with the event", () => {
    expect(inviteTitle("Ana", "Ada Lovelace", "Intro 🍑 - 15 min call")).toBe("Intro 🍑 - 15 min call · Ana x Ada Lovelace");
  });

  it("escapes whatever the guest typed", () => {
    const d = inviteDescription({
      event: "Call",
      host: "Ada",
      questions: [{ id: "agenda", label: "Agenda" }],
      answers: { agenda: '<script>x</script>\nline 2 & "more"' },
      manageUrl: "https://cal.example.com/b/abc",
      siteUrl: "https://cal.example.com",
    });
    expect(d).toContain("&lt;script&gt;x&lt;/script&gt;<br>line 2 &amp; &quot;more&quot;");
    expect(d).toContain('<a href="https://cal.example.com/b/abc">');
    expect(d).toContain('Booked on <a href="https://cal.example.com">cal.example.com</a>');
    expect(esc("<b>")).toBe("&lt;b&gt;");
  });

  it("writes the time in both zones and a Join button", () => {
    expect(whenLine("2026-11-24T19:00:00Z", "2026-11-24T19:45:00Z", "Europe/Paris")).toBe("Tue 24 Nov, 20:00 - 20:45");
    const m = hostEmail({
      kind: "new",
      event: "Podcast",
      hostTimezone: "Europe/Paris",
      start: "2026-11-24T19:00:00Z",
      end: "2026-11-24T19:45:00Z",
      guestName: "Ana",
      guestEmail: "ana@x.co",
      guestTimezone: "America/New_York",
      questions: [{ id: "app", label: "Your app" }],
      answers: { app: "Test" },
      meta: { utm_source: "x" },
      meetUrl: "https://meet.google.com/abc",
      cancelReason: null,
      cancelledBy: null,
      movedFrom: null,
      adminUrl: "https://cal.example.com/admin",
    });
    expect(m.subject).toBe("New booking: Ana · Podcast");
    expect(m.text).toContain("Tue 24 Nov, 20:00 - 20:45 (Europe/Paris)");
    expect(m.text).toContain("Tue 24 Nov, 14:00 - 14:45 for them (America/New York)");
    expect(m.html).toContain("Join Google Meet");
    expect(m.html).toContain("Your app");
    expect(m.text).toContain("All bookings: https://cal.example.com/admin");
    const c = hostEmail({ ...{ kind: "cancelled" as const }, event: "Podcast", hostTimezone: "Europe/Paris", start: "2026-11-24T19:00:00Z", end: "2026-11-24T19:45:00Z", guestName: "Ana", guestEmail: "ana@x.co", guestTimezone: null, questions: [], answers: {}, meta: {}, meetUrl: "https://meet.google.com/abc", cancelReason: "sick", cancelledBy: "guest", movedFrom: null, adminUrl: "https://cal.example.com/admin" });
    expect(c.html).not.toContain("Join Google Meet");
    expect(c.text).toContain("Cancelled by the guest");
  });
});
