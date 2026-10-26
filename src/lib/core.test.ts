import { describe, expect, it } from "vitest";
import {
  addDays,
  checkAnswers,
  DEFAULT_QUESTIONS,
  DEFAULT_RULES,
  generateSlots,
  isHostSlug,
  isOpenSlot,
  localDate,
  localTime,
  mergeIntervals,
  parseOverrides,
  parseQuestions,
  parseRules,
  scheduleFor,
  parseWeekly,
  slugify,
  slugTyping,
  weekday,
  withoutInterval,
  zonedToUtc,
  type SlotInput,
} from "./core";

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("time zones", () => {
  it("turns Berlin wall time into UTC across DST", () => {
    expect(iso(zonedToUtc("2026-07-01", "09:00", "Europe/Berlin"))).toBe("2026-07-01T07:00:00.000Z");
    expect(iso(zonedToUtc("2026-12-01", "09:00", "Europe/Berlin"))).toBe("2026-12-01T08:00:00.000Z");
    // US clocks fell back on 2026-11-01, so New York is UTC-5 again.
    // 2026-03-29 is the spring-forward day in the EU: 09:00 is already CEST.
    expect(iso(zonedToUtc("2026-03-29", "09:00", "Europe/Berlin"))).toBe("2026-03-29T07:00:00.000Z");
    expect(iso(zonedToUtc("2026-11-02", "08:00", "America/New_York"))).toBe("2026-11-02T13:00:00.000Z");
  });

  it("reads the local date and time back", () => {
    const t = Date.parse("2026-10-26T23:30:00Z");
    expect(localDate(t, "Europe/Berlin")).toBe("2026-10-27");
    expect(localTime(t, "Europe/Berlin")).toBe("00:30");
    expect(localDate(t, "America/Los_Angeles")).toBe("2026-10-26");
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekday("2026-10-26")).toBe(1);
  });
});

describe("intervals", () => {
  it("merges and cuts", () => {
    expect(mergeIntervals([{ start: 5, end: 9 }, { start: 1, end: 3 }, { start: 3, end: 6 }])).toEqual([{ start: 1, end: 9 }]);
    expect(withoutInterval([{ start: 0, end: 10 }], { start: 3, end: 5 })).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 10 },
    ]);
  });
});

describe("generateSlots", () => {
  // Monday 2026-11-02, host in New York, 08:00-10:00, 15-min calls on a 30-min grid.
  const base: SlotInput = {
    timezone: "America/New_York",
    weekly: { "1": [{ start: "08:00", end: "10:00" }] },
    overrides: {},
    rules: { ...DEFAULT_RULES, duration_min: 15, increment_min: 30, min_notice_min: 0 },
    busy: [],
    now: Date.parse("2026-11-01T00:00:00Z"),
    fromDate: "2026-11-02",
    toDate: "2026-11-02",
  };

  it("lays slots on the grid inside the window", () => {
    const s = generateSlots(base).map((x) => localTime(x.start, "America/New_York"));
    expect(s).toEqual(["08:00", "08:30", "09:00", "09:30"]);
  });

  it("drops slots that touch busy time, buffers included", () => {
    const busy = [{ start: zonedToUtc("2026-11-02", "08:30", "America/New_York"), end: zonedToUtc("2026-11-02", "09:00", "America/New_York") }];
    expect(generateSlots({ ...base, busy }).map((x) => localTime(x.start, "America/New_York"))).toEqual(["08:00", "09:00", "09:30"]);
    const buffered = { ...base, busy, rules: { ...base.rules, buffer_after_min: 20 } };
    expect(generateSlots(buffered).map((x) => localTime(x.start, "America/New_York"))).toEqual(["09:00", "09:30"]);
  });

  it("respects notice, horizon, closed days, overrides and the daily cap", () => {
    const now = zonedToUtc("2026-11-02", "08:10", "America/New_York");
    expect(generateSlots({ ...base, now, rules: { ...base.rules, min_notice_min: 60 } }).map((x) => localTime(x.start, "America/New_York"))).toEqual([
      "09:30",
    ]);
    expect(generateSlots({ ...base, fromDate: "2026-11-03", toDate: "2026-11-03" })).toEqual([]);
    expect(generateSlots({ ...base, overrides: { "2026-11-02": [] } })).toEqual([]);
    expect(generateSlots({ ...base, overrides: { "2026-11-03": [{ start: "12:00", end: "12:15" }] }, toDate: "2026-11-03" })).toHaveLength(5);
    expect(generateSlots({ ...base, rules: { ...base.rules, max_per_day: 1 }, bookedPerDay: { "2026-11-02": 1 } })).toEqual([]);
    expect(generateSlots({ ...base, rules: { ...base.rules, max_days_ahead: 2 } })).toHaveLength(4);
    expect(generateSlots({ ...base, now: Date.parse("2026-10-20T00:00:00Z"), rules: { ...base.rules, max_days_ahead: 1 } })).toEqual([]);
  });

  it("isOpenSlot checks one start", () => {
    const start = zonedToUtc("2026-11-02", "09:00", "America/New_York");
    expect(isOpenSlot(start, base)).toBe(true);
    expect(isOpenSlot(start + 5 * MIN, base)).toBe(false);
  });
});

describe("input checks", () => {
  it("slugs", () => {
    expect(slugify("Ada Lovelace")).toBe("ada-lovelace");
    expect(slugify("Acme Studio - Intro Call (15 mins)")).toBe("acme-studio-intro-call-15-mins");
    expect(isHostSlug("ada-lovelace")).toBe(true);
    expect(slugTyping("intro-")).toBe("intro-");
    expect(slugTyping("Intro Call")).toBe("intro-call");
    expect(slugify("intro-")).toBe("intro");
    expect(isHostSlug("b")).toBe(false);
    expect(isHostSlug("api")).toBe(false);
    expect(isHostSlug("admin")).toBe(false);
    expect(isHostSlug("An")).toBe(false);
  });

  it("weekly hours and overrides", () => {
    expect(parseWeekly({ "1": [{ start: "13:00", end: "15:00" }, { start: "08:00", end: "12:00" }] })).toEqual({
      "1": [
        { start: "08:00", end: "12:00" },
        { start: "13:00", end: "15:00" },
      ],
    });
    expect(parseWeekly({ "7": [] })).toBeNull();
    expect(parseWeekly({ "1": [{ start: "10:00", end: "09:00" }] })).toBeNull();
    expect(parseOverrides({ "2026-12-24": [] })).toEqual({ "2026-12-24": [] });
    expect(parseOverrides({ "24-12-2026": [] })).toBeNull();
  });

  it("questions and answers", () => {
    expect(parseQuestions(DEFAULT_QUESTIONS)).toEqual(DEFAULT_QUESTIONS);
    expect(parseQuestions([{ id: "email", label: "x", kind: "text" }])).toBeNull();
    expect(parseQuestions([{ id: "budget", label: "Budget", kind: "select", options: ["Low"] }])).toBeNull();
    const bad = checkAnswers(DEFAULT_QUESTIONS, { name: "Ana", email: "ana@x.co", answers: { other: "x" } });
    expect(bad).toEqual({ ok: false, error: "answer_required:agenda" });
    const good = checkAnswers(DEFAULT_QUESTIONS, { name: " Ana ", email: "Ana@X.co", answers: { agenda: "Growth", other: "dropped" }, guests: "Bo@y.co, ana@x.co bo@y.co" });
    expect(good).toEqual({ ok: true, form: { name: "Ana", email: "ana@x.co", answers: { agenda: "Growth" }, guests: ["bo@y.co"] } });
    expect(checkAnswers(DEFAULT_QUESTIONS, { name: "Ana", email: "ana@x.co", answers: { agenda: "x" }, guests: "not-an-email" })).toEqual({ ok: false, error: "guests_invalid" });
    expect(checkAnswers([], { name: "Ana", email: "nope" })).toEqual({ ok: false, error: "email_invalid" });
  });

  it("rules", () => {
    expect(parseRules({ duration_min: 15 })).toEqual({ ...DEFAULT_RULES, duration_min: 15 });
    expect(parseRules({ duration_min: 2 })).toBeNull();
    expect(parseRules({ max_per_day: 3 })?.max_per_day).toBe(3);
    expect(parseRules({ max_per_day: null }, { ...DEFAULT_RULES, max_per_day: 3 })?.max_per_day).toBeNull();
  });
});

describe("scheduleFor", () => {
  const host = { timezone: "America/New_York", weekly_hours: { "1": [{ start: "08:00", end: "13:00" }] }, date_overrides: { "2026-12-24": [] } };
  it("follows the host when the event has no hours of its own", () => {
    expect(scheduleFor(host, { weekly_hours: null, timezone: null, date_overrides: null })).toEqual({
      timezone: "America/New_York",
      weekly: host.weekly_hours,
      overrides: { "2026-12-24": [] },
    });
  });
  it("uses the event's own week and zone, and lets its dates win", () => {
    const own = { "2": [{ start: "10:00", end: "12:00" }] };
    const r = scheduleFor(host, { weekly_hours: own, timezone: "Europe/Berlin", date_overrides: { "2026-12-24": [{ start: "09:00", end: "10:00" }] } });
    expect(r.timezone).toBe("Europe/Berlin");
    expect(r.weekly).toBe(own);
    expect(r.overrides["2026-12-24"]).toEqual([{ start: "09:00", end: "10:00" }]);
  });
  it("tolerates a row without the per-event columns", () => {
    expect(scheduleFor(host, {}).weekly).toBe(host.weekly_hours);
  });
});
