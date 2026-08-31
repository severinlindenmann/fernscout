import { describe, expect, test } from "vitest";
import { migrateKeys, reactionKey, scopeToJournal } from "@/lib/reactions";

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
 * Whose picks come back.
 *
 * Spanning trips is deliberate — one browser has one voter id, and the pager
 * wants this reader's reactions for the whole journal in one request. Spanning
 * journals is not: `reactions.owner_id` is a constant and the qualified ref is
 * the tenant boundary (lib/db/owner.ts), so an unscoped answer handed one
 * journal's page the list of trips this visitor reacts to on another's.
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
