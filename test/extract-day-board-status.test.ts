import { describe, expect, test } from "vitest";
import { dayProgressPercent, nextDayToTell, statusFor, weekdayLabel } from "@/components/extract/DayBoard";

/**
 * The design's three status pills (S5a) — B1803 Task 3.2. `"noPlace"` reads
 * a real signal (an open `fills: "location"` gap question), not a second
 * guess about how much progress looks "worse" than another day's.
 */
describe("statusFor", () => {
  test("told — nothing left open", () => {
    expect(statusFor([])).toBe("told");
  });

  test("noPlace — an open gap question specifically fills location", () => {
    expect(statusFor([{ fills: "location" }, { fills: undefined }])).toBe("noPlace");
  });

  test("notYet — open questions, but none of them are the location gap", () => {
    expect(statusFor([{ fills: undefined }, { fills: "people" }])).toBe("notYet");
  });
});

describe("dayProgressPercent", () => {
  test("real arithmetic on answered vs. still open", () => {
    expect(dayProgressPercent(1, 3)).toBe(25);
    expect(dayProgressPercent(2, 2)).toBe(50);
  });

  test("zero rather than dividing by zero when nothing has ever been asked", () => {
    expect(dayProgressPercent(0, 0)).toBe(0);
  });
});

describe("nextDayToTell", () => {
  test("the first dated, not-told day — in the run's own chronological order", () => {
    const days = [
      { date: "2026-06-01", undated: false, status: "told" as const },
      { date: "2026-06-02", undated: false, status: "noPlace" as const },
      { date: "2026-06-03", undated: false, status: "notYet" as const },
    ];
    expect(nextDayToTell(days)).toBe("2026-06-02");
  });

  test("the undated group is never the next day — it has no weekday to name", () => {
    const days = [
      { date: "2026-06-01", undated: false, status: "told" as const },
      { date: "", undated: true, status: "notYet" as const },
      { date: "2026-06-03", undated: false, status: "notYet" as const },
    ];
    expect(nextDayToTell(days)).toBe("2026-06-03");
  });

  test("undefined once every real day is told — never a day that does not exist", () => {
    const days = [
      { date: "2026-06-01", undated: false, status: "told" as const },
      { date: "", undated: true, status: "told" as const },
    ];
    expect(nextDayToTell(days)).toBeUndefined();
  });
});

describe("weekdayLabel", () => {
  test("the real weekday, in the reader's own language, from a fixed noon-UTC instant", () => {
    expect(weekdayLabel("2026-06-02", "en")).toBe("Tuesday");
    expect(weekdayLabel("2026-06-02", "de")).toBe("Dienstag");
  });

  // B1803 final review, finding 1. The undated group's own date is `""`
  // (`lib/extract/group.ts`), and `""` reaching a weekday formatter used to
  // throw a RangeError out of `Intl.DateTimeFormat.format` — taking the
  // whole screen down with no error boundary under it. There is no weekday
  // for a day with no date, so there is no label either: an empty string,
  // which every caller already drops rather than printing.
  test("a date it cannot parse gets no label, and never throws", () => {
    expect(weekdayLabel("", "en")).toBe("");
    expect(weekdayLabel("banana", "en")).toBe("");
    expect(weekdayLabel("0000-99-99", "en")).toBe("");
  });
});
