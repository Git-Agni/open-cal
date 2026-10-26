import { describe, expect, it } from "vitest";
import { buildMime, normalizePrivateKey } from "./google";

describe("mail", () => {
  it("builds a plain-text message and keeps headers on one line", () => {
    const m = buildMime({ from: "host@example.com", fromName: "open-cal", to: ["host@example.com"], replyTo: "guest@example.org", subject: "New booking: Zoë\r\nBcc: x@evil.test", text: "Hi" });
    expect(m).toContain("From: open-cal <host@example.com>");
    expect(m).toContain("Reply-To: guest@example.org");
    expect(m).not.toMatch(/\r\nBcc:/);
    expect(m).toContain(Buffer.from("Hi").toString("base64"));
  });
});

describe("private key", () => {
  it("rebuilds a key pasted with literal \\n and quotes", () => {
    const body = "A".repeat(100);
    const k = normalizePrivateKey(`"-----BEGIN PRIVATE KEY-----\\n${body}\\n-----END PRIVATE KEY-----\\n"`);
    expect(k).toBe(`-----BEGIN PRIVATE KEY-----\n${"A".repeat(64)}\n${"A".repeat(36)}\n-----END PRIVATE KEY-----\n`);
  });
});
