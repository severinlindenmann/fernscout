import { describe, expect, test } from "vitest";
import { canShiftMonth, clampDate, keyboardDate, monthWindow, shiftMonth } from "@/lib/studio/monthGrid";

describe("monthWindow", () => {
  test("pads September 2026 to Monday-first complete weeks", () => {
    const days = monthWindow("2026-09-21");
    expect(days).toHaveLength(35);
    expect(days.slice(0, 3)).toEqual([null, "2026-09-01", "2026-09-02"]);
    expect(days.slice(-5)).toEqual(["2026-09-30", null, null, null, null]);
    expect(days.filter(Boolean)).toHaveLength(30);
  });
  test("handles Monday starts, Sunday starts, leap years and six-row months", () => {
    expect(monthWindow("2021-02-10")).toHaveLength(28);
    expect(monthWindow("2026-02-10").slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-02-01"]);
    expect(monthWindow("2024-02-01")).toContain("2024-02-29");
    expect(monthWindow("2026-03-01")).toHaveLength(42);
  });
});

describe("month navigation and bounds", () => {
  test("preserves days and clamps at month ends across years", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonth("2024-03-31", -1)).toBe("2024-02-29");
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-15");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-15");
    expect(shiftMonth("2026-01-31", 0)).toBe("2026-01-31");
  });
  test("allows partially bounded months but stops beyond bounds", () => {
    expect(canShiftMonth("2026-09-21", -1, "2026-08-31", "2026-10-01")).toBe(true);
    expect(canShiftMonth("2026-09-21", 1, "2026-08-31", "2026-10-01")).toBe(true);
    expect(canShiftMonth("2026-08-31", -1, "2026-08-31", "2026-10-01")).toBe(false);
    expect(canShiftMonth("2026-10-01", 1, "2026-08-31", "2026-10-01")).toBe(false);
  });
  test("clamps inclusively, including a one-day range", () => {
    for (const date of ["2026-08-01", "2026-09-21", "2026-10-01"]) {
      expect(clampDate(date, "2026-09-21", "2026-09-21")).toBe("2026-09-21");
    }
    expect(clampDate("2026-09-15", "2026-09-01", "2026-09-30")).toBe("2026-09-15");
  });
});

describe("keyboardDate", () => {
  const start = "2025-01-01", end = "2027-12-31";
  test("arrows cross month boundaries and Home/End use Monday/Sunday", () => {
    for (const [key, expected] of Object.entries({ ArrowLeft: "2026-09-23", ArrowRight: "2026-09-25", ArrowUp: "2026-09-17", ArrowDown: "2026-10-01", Home: "2026-09-21", End: "2026-09-27" })) {
      expect(keyboardDate("2026-09-24", key, start, end)).toBe(expected);
    }
    expect(keyboardDate("2026-09-27", "Home", start, end)).toBe("2026-09-21");
    expect(keyboardDate("2026-10-01", "ArrowLeft", start, end)).toBe("2026-09-30");
  });
  test("PageUp/PageDown clamp month ends and all movement respects bounds", () => {
    expect(keyboardDate("2026-01-31", "PageDown", start, end)).toBe("2026-02-28");
    expect(keyboardDate("2026-03-31", "PageUp", start, end)).toBe("2026-02-28");
    expect(keyboardDate("2026-09-21", "Home", "2026-09-20", "2026-09-21")).toBe("2026-09-21");
    expect(keyboardDate("2026-09-21", "ArrowLeft", "2026-09-21", "2026-09-30")).toBe("2026-09-21");
    expect(keyboardDate("2026-09-21", "PageDown", "2026-09-01", "2026-09-25")).toBe("2026-09-25");
    expect(keyboardDate("2026-09-21", "Enter", start, end)).toBeNull();
  });
});
