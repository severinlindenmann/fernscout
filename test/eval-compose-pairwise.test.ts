import { describe, expect, test } from "vitest";
import { fromVerdictRecords, pairwiseVerdict, tallyPairwise } from "../scripts/eval-compose/pairwise";
import type { PairwiseVerdictRecord } from "../scripts/eval-compose/types";

/**
 * The swap rule — B2692's own reason for judging in both orders (MT-Bench's
 * finding that a judge asked only once is biased toward whichever side it
 * saw first). A win must survive being asked the other way round.
 */
describe("pairwiseVerdict", () => {
  test("agrees across the swap: a genuine win", () => {
    // order1 saw (A, B) and preferred "first" (A); order2 saw (B, A) and
    // preferred "second" (A again) — both orders say A.
    expect(pairwiseVerdict({ order1: "first", order2: "second" })).toBe("a");
    expect(pairwiseVerdict({ order1: "second", order2: "first" })).toBe("b");
  });

  test("disagrees across the swap: a tie, not a win for whoever went first", () => {
    // order1 preferred "first" (A); order2 also preferred "first" (B) —
    // that is the position-bias case, and it must not count as a B win.
    expect(pairwiseVerdict({ order1: "first", order2: "first" })).toBe("tie");
    expect(pairwiseVerdict({ order1: "second", order2: "second" })).toBe("tie");
  });

  test("a tie in either order is a tie overall", () => {
    expect(pairwiseVerdict({ order1: "tie", order2: "second" })).toBe("tie");
    expect(pairwiseVerdict({ order1: "first", order2: "tie" })).toBe("tie");
  });
});

describe("tallyPairwise", () => {
  test("counts wins only where both orders agree", () => {
    const tally = tallyPairwise([
      { caseId: "1", label: "one", order1: "first", order2: "second" }, // a
      { caseId: "2", label: "two", order1: "first", order2: "first" }, // tie (position bias)
      { caseId: "3", label: "three", order1: "second", order2: "first" }, // b
    ]);
    expect(tally).toEqual({
      aWins: 1,
      bWins: 1,
      ties: 1,
      perCase: [
        { caseId: "1", label: "one", verdict: "a" },
        { caseId: "2", label: "two", verdict: "tie" },
        { caseId: "3", label: "three", verdict: "b" },
      ],
    });
  });
});

describe("fromVerdictRecords", () => {
  test("pairs an AB and a BA row into one case, and reports a case missing either as incomplete", () => {
    const records: PairwiseVerdictRecord[] = [
      { caseId: "1", order: "AB", pick: "first", note: "" },
      { caseId: "1", order: "BA", pick: "second", note: "" },
      { caseId: "2", order: "AB", pick: "tie", note: "" }, // never gets its BA row
    ];
    const { results, incomplete } = fromVerdictRecords(new Map([["1", "one"], ["2", "two"]]), records);
    expect(results).toEqual([{ caseId: "1", label: "one", order1: "first", order2: "second" }]);
    expect(incomplete).toEqual(["2"]);
  });
});
