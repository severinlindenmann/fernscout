import { describe, expect, test } from "vitest";
import { countDays } from "@/lib/extract/dayCount";
import { groupIntoDays } from "@/lib/extract/group";
import type { PhotoRow } from "@/lib/staging/manifest";

const p = (id: string, takenAt?: string, lat?: number, lng?: number): PhotoRow => ({
  id, filename: id, bytes: 1, kind: "image", takenAt, date: takenAt?.slice(0, 10), lat, lng,
});

/**
 * B1803 Phase 2 fix round 1, finding 1 — the undated group is real work (the
 * board still shows a card for it) but it is not a day: `FoundStep` already
 * promised a day count before the board ever renders, and it must not say a
 * different number a screen later just because a run had one undated
 * photograph. `countDays` is the one place both screens read that count
 * from, so they cannot drift apart again.
 */
describe("countDays — the undated group is not a day", () => {
  test("an undated group must not inflate the count FoundStep already promised", () => {
    const groups = groupIntoDays([
      p("a", "2019-07-02T10:07:00", 15.88, 108.33),
      p("b", "2019-07-03T10:07:00", 15.88, 108.33),
      p("c"), // no takenAt — lands in the synthetic undated group
    ]);
    expect(groups).toHaveLength(3); // two real days + the undated group
    expect(countDays(groups)).toBe(2); // but only two of them are days
  });

  test("no undated group at all is the ordinary case", () => {
    const groups = groupIntoDays([p("a", "2019-07-02T10:07:00"), p("b", "2019-07-03T10:07:00")]);
    expect(countDays(groups)).toBe(2);
  });
});
