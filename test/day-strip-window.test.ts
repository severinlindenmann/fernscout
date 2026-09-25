import { describe, expect, test } from "vitest";
import { canShiftWeek, isOutOfRange, shiftWeek, weekDates, weekdayIndex } from "@/lib/studio/dayStrip";

// B1989 — the pure week-window and bounds logic behind DayStrip. 2026-09-21
// is a Monday; the fixed dates below are chosen around that so the math is
// checkable by hand rather than only by re-deriving it in the test itself.

describe("weekDates", () => {
  test("returns the Monday-to-Sunday week containing the anchor", () => {
    expect(weekDates("2026-09-24")).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
  });

  test("a Sunday anchor still lands in its own Mon-Sun week", () => {
    const days = weekDates("2026-09-27");
    expect(days[0]).toBe("2026-09-21");
    expect(days[6]).toBe("2026-09-27");
  });
});

describe("shiftWeek", () => {
  test("moves by whole weeks, keeping the same weekday", () => {
    expect(shiftWeek("2026-09-24", 1)).toBe("2026-10-01");
    expect(shiftWeek("2026-09-24", -1)).toBe("2026-09-17");
  });

  test("zero weeks is a no-op", () => {
    expect(shiftWeek("2026-09-24", 0)).toBe("2026-09-24");
  });
});

describe("canShiftWeek", () => {
  test("refuses to page past the trip start", () => {
    // Anchor's own week starts 2026-09-21; the start bound is the same
    // date, so the previous week (09-14..09-20) has nothing choosable in it.
    expect(canShiftWeek("2026-09-21", -1, "2026-09-21", "2026-09-30")).toBe(false);
  });

  test("refuses to page past the upper bound", () => {
    // Anchor's own week ends 2026-09-27; the next week (09-28..10-04) is
    // entirely past the end bound.
    expect(canShiftWeek("2026-09-24", 1, "2026-09-01", "2026-09-27")).toBe(false);
  });

  test("allows paging while any day of the target week is in range", () => {
    expect(canShiftWeek("2026-09-24", -1, "2026-09-18", "2026-09-30")).toBe(true);
  });
});

describe("isOutOfRange", () => {
  test("a date before start is out of range", () => {
    expect(isOutOfRange("2026-09-19", "2026-09-20", "2026-09-30")).toBe(true);
  });

  test("a date after end is out of range", () => {
    expect(isOutOfRange("2026-10-01", "2026-09-20", "2026-09-30")).toBe(true);
  });

  test("a date inside the bounds is in range, bounds included", () => {
    expect(isOutOfRange("2026-09-25", "2026-09-20", "2026-09-30")).toBe(false);
    expect(isOutOfRange("2026-09-20", "2026-09-20", "2026-09-30")).toBe(false);
    expect(isOutOfRange("2026-09-30", "2026-09-20", "2026-09-30")).toBe(false);
  });
});

describe("weekdayIndex", () => {
  test("matches JS getUTCDay indexing (0=Sunday)", () => {
    expect(weekdayIndex("2026-09-21")).toBe(1); // Monday
    expect(weekdayIndex("2026-09-27")).toBe(0); // Sunday
  });
});
