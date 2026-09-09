import { describe, expect, test } from "vitest";
import { pick, stateOf, whenWords, type JournalView } from "@/app/admin/Journals";

/**
 * The search and the sort on `/admin` — B893, widened by B1181.
 *
 * `pick` is the whole of what the two controls do, so it is the whole of what
 * there is to get wrong: a list that silently drops a journal, or one that
 * claims to be sorted by cost and is not, is a wrong answer about somebody's
 * money rather than a cosmetic fault.
 */
function journal(
  username: string,
  rappen: number,
  balance: number | null,
  lastWroteAt: string | null = null,
): JournalView {
  return {
    username,
    rappen,
    balance,
    spent: 0,
    granted: 0,
    lastWroteAt,
    disk: "0 B",
    full: null,
    panel: null,
  };
}

const ROWS = [
  journal("ana", 100, 50, "2026-09-01T00:00:00.000Z"),
  journal("bo", 900, 5, "2026-06-01T00:00:00.000Z"),
  journal("cartography", 400, null),
];

describe("the journal list", () => {
  test("is costliest first when asked", () => {
    expect(pick(ROWS, "", "cost").map((row) => row.username)).toEqual(["bo", "cartography", "ana"]);
  });

  test("sorts by who wrote most recently, with the never-started last", () => {
    // Not merely "newest first": a journal with no day at all has an empty
    // timestamp, which sorts *above* every real one under a plain ascending
    // compare — putting the rows with nothing in them at the top of the list
    // the operator reads first.
    expect(pick(ROWS, "", "recent").map((row) => row.username)).toEqual([
      "ana",
      "bo",
      "cartography",
    ]);
  });

  test("sorts by name and by balance", () => {
    expect(pick(ROWS, "", "name").map((row) => row.username)).toEqual(["ana", "bo", "cartography"]);
    // A journal with no credits on this instance sorts as zero rather than
    // being dropped: it is still a journal the operator has to see.
    expect(pick(ROWS, "", "balance").map((row) => row.username)).toEqual(["cartography", "bo", "ana"]);
  });

  test("searches anywhere in the name, and ignoring case", () => {
    expect(pick(ROWS, "OGRAPH", "name").map((row) => row.username)).toEqual(["cartography"]);
    expect(pick(ROWS, "  ", "name")).toHaveLength(3);
    expect(pick(ROWS, "zz", "name")).toHaveLength(0);
  });

  test("does not reorder the caller's array", () => {
    const rows = [...ROWS];
    pick(rows, "", "cost");
    expect(rows.map((row) => row.username)).toEqual(["ana", "bo", "cartography"]);
  });
});

/**
 * Alive, quiet, dormant, never started — B1181.
 *
 * The four words a row is read by. A journal that has never written anything
 * and one nobody has touched since the spring both spend nothing and are
 * opposite facts about a person, so the boundaries between them are pinned
 * here rather than left to a comparison somebody adjusts by eye.
 */
describe("how a journal reads", () => {
  const now = Date.parse("2026-09-09T12:00:00.000Z");
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

  test("never started is not the same as dormant", () => {
    expect(stateOf(null, now).word).toBe("never started");
    expect(stateOf(daysAgo(200), now).word).toBe("dormant");
    expect(whenWords(null, now)).toBe("never wrote a day");
  });

  test("turns at a fortnight and at a season", () => {
    expect(stateOf(daysAgo(1), now).word).toBe("writing");
    expect(stateOf(daysAgo(14), now).word).toBe("writing");
    expect(stateOf(daysAgo(15), now).word).toBe("quiet");
    expect(stateOf(daysAgo(90), now).word).toBe("quiet");
    expect(stateOf(daysAgo(91), now).word).toBe("dormant");
  });

  test("says when in the coarsest words that are still true", () => {
    expect(whenWords(daysAgo(0), now)).toBe("wrote today");
    expect(whenWords(daysAgo(1), now)).toBe("wrote yesterday");
    expect(whenWords(daysAgo(4), now)).toBe("wrote 4 days ago");
    expect(whenWords(daysAgo(21), now)).toBe("wrote 3 weeks ago");
    expect(whenWords(daysAgo(120), now)).toBe("wrote 4 months ago");
  });
});
