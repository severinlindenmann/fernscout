import { describe, expect, test } from "vitest";
import { pick, type JournalView } from "@/app/admin/Journals";

/**
 * The search and the sort on `/admin` — B893.
 *
 * `pick` is the whole of what the two controls do, so it is the whole of what
 * there is to get wrong: a list that silently drops a journal, or one that
 * claims to be sorted by cost and is not, is a wrong answer about somebody's
 * money rather than a cosmetic fault.
 */
function journal(username: string, rappen: number, balance: number | null): JournalView {
  return { username, rappen, balance, spent: 0, granted: 0, panel: null };
}

const ROWS = [
  journal("ana", 100, 50),
  journal("bo", 900, 5),
  journal("cartography", 400, null),
];

describe("the journal list", () => {
  test("is costliest first by default", () => {
    expect(pick(ROWS, "", "cost").map((row) => row.username)).toEqual(["bo", "cartography", "ana"]);
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
