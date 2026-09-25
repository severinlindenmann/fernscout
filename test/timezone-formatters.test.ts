import { describe, expect, test } from "vitest";
import { formatTimeInZone, zonedTimeToUtc } from "@/lib/timezone";

/**
 * lib/timezone.ts keeps one `Intl.DateTimeFormat` per zone rather than making
 * two per call. Reuse must not change an answer: zones asked in turn keep
 * their own offsets, the same zone keeps reading DST off the date it is asked
 * about rather than the date it was first asked about, and a zone `Intl`
 * refuses is refused every time rather than once.
 */
describe("zone conversions with reused formatters", () => {
  test("interleaved zones and dates each keep their own offset", () => {
    for (let i = 0; i < 3; i++) {
      // Zurich: CET (+1) in January, CEST (+2) in July.
      expect(zonedTimeToUtc("2024-01-15", "12:00", "Europe/Zurich").toISOString()).toBe(
        "2024-01-15T11:00:00.000Z",
      );
      expect(zonedTimeToUtc("2024-07-15", "12:00", "Europe/Zurich").toISOString()).toBe(
        "2024-07-15T10:00:00.000Z",
      );
      // Bangkok: +7, no DST.
      expect(zonedTimeToUtc("2024-07-15", "12:00", "Asia/Bangkok").toISOString()).toBe(
        "2024-07-15T05:00:00.000Z",
      );
    }
  });

  test("the dual clock reads back in the target zone, whichever was asked first", () => {
    expect(formatTimeInZone("2024-07-15", "12:00", "Asia/Bangkok", "Europe/Zurich")).toBe("07:00");
    expect(formatTimeInZone("2024-07-15", "07:00", "Europe/Zurich", "Asia/Bangkok")).toBe("12:00");
    expect(formatTimeInZone("2024-01-15", "12:00", "Asia/Bangkok", "Europe/Zurich")).toBe("06:00");
  });

  test("a zone Intl does not know throws every time, not only the first", () => {
    expect(() => zonedTimeToUtc("2024-07-15", "12:00", "Not/AZone")).toThrow(RangeError);
    expect(() => zonedTimeToUtc("2024-07-15", "12:00", "Not/AZone")).toThrow(RangeError);
  });
});
