import { describe, expect, test } from "vitest";
import { accessSecret, isIndexable, isOpenToLink, isTestContent, maySeeCosts } from "@/lib/access";
import type { Trip } from "@/lib/types";

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: "t",
    username: "u",
    ref: "u/t",
    title: "T",
    start: "2026-01-01",
    end: "2026-01-05",
    status: "past",
    people: [],
    travellers: [],
    listed: true,
    accent: "sky",
    rates: {},
    intro: "",
    visibility: "public",
    costsVisibility: "public",
    ...over,
  };
}

describe("visibility predicates", () => {
  test("a public, listed trip is indexable and nothing else is", () => {
    expect(isIndexable(trip({ visibility: "public", listed: true }))).toBe(true);
    // The old `unlisted`: public, but not advertised.
    expect(isIndexable(trip({ visibility: "public", listed: false }))).toBe(false);
    expect(isIndexable(trip({ visibility: "guest", listed: false }))).toBe(false);
    expect(isIndexable(trip({ visibility: "private", listed: false }))).toBe(false);
  });

  test("only a public trip opens to a bare link", () => {
    expect(isOpenToLink(trip({ visibility: "public", listed: true }))).toBe(true);
    expect(isOpenToLink(trip({ visibility: "public", listed: false }))).toBe(true);
    expect(isOpenToLink(trip({ visibility: "guest" }))).toBe(false);
    expect(isOpenToLink(trip({ visibility: "private" }))).toBe(false);
  });

  test("guests-only costs need a guest", () => {
    expect(maySeeCosts(trip({ costsVisibility: "guests" }), false)).toBe(false);
    expect(maySeeCosts(trip({ costsVisibility: "guests" }), true)).toBe(true);
    expect(maySeeCosts(trip({ costsVisibility: "public" }), false)).toBe(true);
  });
});

/**
 * The one function in this file that is not about visibility at all.
 *
 * It signed the trip-password cookie, and it stayed when B39 removed the
 * passwords because `lib/agentConfirm.ts` signs every destructive-operation
 * confirmation code with it — deleting it with the rest would have broken
 * agent confirmations, including a journal deletion, with nothing failing to
 * say so. `test/agent-confirm.test.ts` is the test that would have.
 */
describe("accessSecret", () => {
  test("hands back SESSION_SECRET, and says what to do when there is none", () => {
    const saved = process.env.SESSION_SECRET;
    try {
      process.env.SESSION_SECRET = "a".repeat(64);
      expect(accessSecret()).toBe("a".repeat(64));

      delete process.env.SESSION_SECRET;
      expect(() => accessSecret()).toThrow(/SESSION_SECRET/);
    } finally {
      if (saved === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = saved;
    }
  });
});

describe("test content", () => {
  test("a test trip makes every day of it a test day", () => {
    expect(isTestContent(trip({ test: true }))).toBe(true);
    expect(isTestContent(trip(), { test: true })).toBe(true);
    expect(isTestContent(trip())).toBe(false);
    expect(isTestContent(undefined)).toBe(false);
  });
});
