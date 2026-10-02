import { describe, expect, test } from "vitest";
import { reportMailto } from "@/lib/journalPath";

/**
 * B2723 — a reader's "report this journal" link, App Store guideline 1.2.
 * Never for the owner, and never with no operator address to send it to.
 */
const site = (overrides: Partial<Parameters<typeof reportMailto>[0]> = {}) => ({
  isOwner: false,
  operatorEmail: "agent@fernscout.ch",
  url: "https://fernscout.ch",
  base: "/@example",
  ...overrides,
});

describe("reportMailto", () => {
  test("a reader gets a mailto naming the journal", () => {
    expect(reportMailto(site())).toBe(
      "mailto:agent@fernscout.ch?subject=Report%3A%20fernscout.ch%2F%40example",
    );
  });

  test("the owner gets nothing", () => {
    expect(reportMailto(site({ isOwner: true }))).toBeUndefined();
  });

  test("no operator address means no link", () => {
    expect(reportMailto(site({ operatorEmail: undefined }))).toBeUndefined();
  });

  test("the host comes from the site's own url, not a hardcoded one", () => {
    expect(reportMailto(site({ url: "http://localhost:3000" }))).toContain(
      encodeURIComponent("localhost:3000/@example"),
    );
  });
});
