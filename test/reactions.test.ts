import { describe, expect, test } from "vitest";
import { migrateKeys, reactionKey, scopeToJournal, scopeToTrip } from "@/lib/reactions";

describe("reactionKey", () => {
  test("composes trip and day", () => {
    expect(reactionKey("asia-2023", "hoi-an")).toBe("asia-2023:hoi-an");
  });
});

describe("migrateKeys", () => {
  test("prefixes keys written before trips existed", () => {
    const out = migrateKeys({ "hoi-an": { v1: "❤️" } }, "asia-2023");
    expect(out).toEqual({ "asia-2023:hoi-an": { v1: "❤️" } });
  });

  test("leaves already-scoped keys alone", () => {
    const votes = { "algarve-2024:faro": { v1: "😂" } } as const;
    expect(migrateKeys(votes, "asia-2023")).toEqual(votes);
  });

  test("merges when both forms exist for the same day", () => {
    const out = migrateKeys(
      { "hoi-an": { v1: "❤️" }, "asia-2023:hoi-an": { v2: "🤩" } },
      "asia-2023",
    );
    expect(out).toEqual({ "asia-2023:hoi-an": { v2: "🤩", v1: "❤️" } });
  });

  test("is a no-op on an empty store", () => {
    expect(migrateKeys({}, "asia-2023")).toEqual({});
  });

  test("a voter's scoped vote beats their older bare vote", () => {
    const out = migrateKeys(
      { "hoi-an": { v1: "❤️" }, "asia-2023:hoi-an": { v1: "🤩" } },
      "asia-2023",
    );
    expect(out).toEqual({ "asia-2023:hoi-an": { v1: "🤩" } });
  });

  test("a voter's scoped vote beats their older bare vote, keys in the opposite order", () => {
    const out = migrateKeys(
      { "asia-2023:hoi-an": { v1: "🤩" }, "hoi-an": { v1: "❤️" } },
      "asia-2023",
    );
    expect(out).toEqual({ "asia-2023:hoi-an": { v1: "🤩" } });
  });
});

/**
 * `getVotesFor`'s actual filter since B239 — one trip, not the whole journal.
 *
 * Both storage backends answer a voter id's rows across every trip the
 * journal has; without this, a voter id that leaked in a query string (it is
 * a `crypto.randomUUID()`, so not guessable, but not a secret either — it
 * lands in access logs and `Referer` headers) would hand back the day slugs
 * of trips the caller asking was never gated against.
 */
describe("scopeToTrip", () => {
  const votes = {
    "alex/asia-2023:hoi-an": "❤️",
    "alex/alps-2024:susten": "😂",
    "bea/pyrenees-2025:over-the-susten": "🤩",
  };

  test("keeps only the trip asked for, not the rest of the journal", () => {
    expect(scopeToTrip(votes, "alex/asia-2023")).toEqual({
      "alex/asia-2023:hoi-an": "❤️",
    });
  });

  test("a trip id that prefixes another's is not swept up", () => {
    expect(scopeToTrip({ "al/x:d": "a", "al/x-2:d": "b" }, "al/x")).toEqual({
      "al/x:d": "a",
    });
  });

  /** The pre-multi-user store has no trip in its keys. */
  test("a bare id scopes nothing", () => {
    expect(scopeToTrip({ "asia-2023:hoi-an": "❤️" }, "asia-2023")).toEqual({
      "asia-2023:hoi-an": "❤️",
    });
  });
});

/**
 * `scopeToJournal` — no longer `getVotesFor`'s filter (see `scopeToTrip`
 * above), kept because it states a real, narrower-than-nothing guarantee and
 * is tested in its own right.
 */
describe("scopeToJournal", () => {
  const votes = {
    "alex/asia-2023:hoi-an": "\u2764\ufe0f",
    "alex/alps-2024:susten": "\ud83d\ude02",
    "bea/pyrenees-2025:over-the-susten": "\ud83e\udd29",
  };

  test("keeps every trip of the journal asked for", () => {
    expect(scopeToJournal(votes, "alex/asia-2023")).toEqual({
      "alex/asia-2023:hoi-an": "\u2764\ufe0f",
      "alex/alps-2024:susten": "\ud83d\ude02",
    });
  });

  test("drops another journal's", () => {
    expect(scopeToJournal(votes, "bea/pyrenees-2025")).toEqual({
      "bea/pyrenees-2025:over-the-susten": "\ud83e\udd29",
    });
  });

  test("a journal whose name prefixes another's is not swept up", () => {
    expect(
      scopeToJournal({ "al/x:d": "a", "alex/y:d": "b" }, "al/x"),
    ).toEqual({ "al/x:d": "a" });
  });

  /** The pre-multi-user store has no journal in its keys. */
  test("a bare id scopes nothing", () => {
    expect(scopeToJournal({ "asia-2023:hoi-an": "\u2764\ufe0f" }, "asia-2023")).toEqual({
      "asia-2023:hoi-an": "\u2764\ufe0f",
    });
  });
});
