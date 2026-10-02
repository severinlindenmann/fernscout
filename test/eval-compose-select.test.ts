import { describe, expect, test } from "vitest";
import { selectVariety, type Candidate } from "../scripts/eval-compose/select-cases";

/**
 * B2692's case picker — pure, so this is the whole proof that "spread
 * across trips, short/long variety" means something deterministic rather
 * than whatever `Array.sort` felt like that day.
 */
describe("selectVariety", () => {
  test("picks nothing from nothing, and never more than max", () => {
    expect(selectVariety([], 5)).toEqual([]);
    const many: Candidate[] = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, tripId: "t1", words: i + 1 }));
    expect(selectVariety(many, 3)).toHaveLength(3);
    expect(selectVariety(many, 0)).toEqual([]);
  });

  test("round-robins across trips before taking a second day from any one", () => {
    const candidates: Candidate[] = [
      { id: "a1", tripId: "a", words: 10 },
      { id: "a2", tripId: "a", words: 20 },
      { id: "a3", tripId: "a", words: 30 },
      { id: "b1", tripId: "b", words: 5 },
    ];
    const picked = selectVariety(candidates, 2);
    const trips = picked.map((c) => c.tripId);
    expect(trips).toEqual(["a", "b"]);
  });

  test("alternates shortest and longest within a trip", () => {
    const candidates: Candidate[] = [
      { id: "short", tripId: "t", words: 5 },
      { id: "mid", tripId: "t", words: 50 },
      { id: "long", tripId: "t", words: 500 },
    ];
    const picked = selectVariety(candidates, 3);
    expect(picked.map((c) => c.id)).toEqual(["short", "long", "mid"]);
  });

  test("is deterministic over the same input", () => {
    const candidates: Candidate[] = [
      { id: "a1", tripId: "a", words: 10 },
      { id: "a2", tripId: "a", words: 90 },
      { id: "b1", tripId: "b", words: 30 },
      { id: "b2", tripId: "b", words: 60 },
      { id: "c1", tripId: "c", words: 15 },
    ];
    expect(selectVariety(candidates, 4)).toEqual(selectVariety(candidates, 4));
  });

  test("exhausts a short trip's queue without stalling the round robin", () => {
    const candidates: Candidate[] = [
      { id: "a1", tripId: "a", words: 10 },
      { id: "b1", tripId: "b", words: 5 },
      { id: "b2", tripId: "b", words: 15 },
      { id: "b3", tripId: "b", words: 25 },
    ];
    const picked = selectVariety(candidates, 4);
    expect(picked.map((c) => c.id).sort()).toEqual(["a1", "b1", "b2", "b3"]);
  });
});
