import { describe, expect, test } from "vitest";
import { dayProgressPercent, statusFor } from "@/components/extract/DayBoard";

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
