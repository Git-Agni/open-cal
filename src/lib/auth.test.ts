import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminConfigured, checkPassword, newSessionValue, validSession } from "./auth";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

describe("admin password", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "correct horse battery staple";
  });
  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
  });

  it("is locked without a long enough password", () => {
    process.env.ADMIN_PASSWORD = "short";
    expect(adminConfigured()).toBe(false);
    expect(checkPassword("short")).toBe(false);
  });

  it("checks the password", () => {
    expect(adminConfigured()).toBe(true);
    expect(checkPassword("correct horse battery staple")).toBe(true);
    expect(checkPassword("correct horse battery")).toBe(false);
    expect(checkPassword(undefined)).toBe(false);
  });

  it("signs sessions that expire and die with a password change", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    const v = newSessionValue(now);
    expect(validSession(v, now + 1000)).toBe(true);
    expect(validSession(v, now + 31 * 86_400_000)).toBe(false);
    expect(validSession(v.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now)).toBe(false);
    expect(validSession(`${now + 99 * 86_400_000}.${v.split(".")[1]}`, now)).toBe(false);
    process.env.ADMIN_PASSWORD = "another long password";
    expect(validSession(v, now + 1000)).toBe(false);
  });
});
