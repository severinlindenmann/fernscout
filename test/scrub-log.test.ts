import { describe, expect, it } from "vitest";
import { scrubLog } from "../lib/scrubLog";

describe("scrubLog", () => {
  it("redacts emails", () => {
    expect(scrubLog("failed for jo@example.com today", 100)).toBe("failed for [email] today");
  });
  it("redacts bearer and fs_ tokens", () => {
    const out = scrubLog("Authorization: Bearer abc.def-123 and fs_secretvalue", 100);
    expect(out).not.toContain("abc.def");
    expect(out).not.toContain("secretvalue");
  });
  it("redacts long opaque runs", () => {
    expect(scrubLog("id 0123456789abcdef0123456789abcdef end", 100)).toBe("id [redacted] end");
  });
  it("drops query strings", () => {
    expect(scrubLog("GET /x?code=123456&u=a b", 100)).toBe("GET /x?[query] b");
  });
  it("cannot be used to forge a line", () => {
    expect(scrubLog("a\r\n[request] GET /\tb", 100)).not.toMatch(/[\r\n\t]/);
  });
  it("truncates", () => {
    expect(scrubLog("x".repeat(50), 10)).toHaveLength(10);
  });
  it("keeps a real route and slug readable", () => {
    expect(scrubLog("/@example/trips/parks-2025/day/great-sand-dunes", 200)).toBe(
      "/@example/trips/parks-2025/day/great-sand-dunes",
    );
  });
  it("redacts a uuid and a long hex run", () => {
    expect(scrubLog("id 123e4567-e89b-12d3-a456-426614174000", 200)).toBe("id [redacted]");
    expect(scrubLog("a".repeat(40), 200)).toBe("[redacted]");
  });
  it("redacts a hyphenated mixed-case token but not a slug", () => {
    expect(scrubLog("t Ab3-Cd4-Ef5-Gh6-Ij7-Kl8-Mn9-Op0 end", 200)).toBe("t [redacted] end");
    expect(scrubLog("2026-10-01-lisbon-to-porto-and-the-douro", 200)).toBe("2026-10-01-lisbon-to-porto-and-the-douro");
  });
});
