import { describe, expect, test } from "vitest";
import { partTimeOfDay, splitIntoParts, waitingSheetPreselectsAll } from "@/lib/studio/dayParts";

/** TIX-2 — splitting one day's photographs into a handful of parts, by time
 *  and distance alone. Pure function, no I/O. */

const T = (hhmm: string) => `2026-06-22T${hhmm}:00`;

describe("waitingSheetPreselectsAll — B2676, the photo sheet's own Waiting tab", () => {
  test("20 or fewer waiting for this day: all pre-selected", () => {
    expect(waitingSheetPreselectsAll(0)).toBe(true);
    expect(waitingSheetPreselectsAll(1)).toBe(true);
    expect(waitingSheetPreselectsAll(20)).toBe(true);
  });

  test("more than 20 waiting for this day: none pre-selected", () => {
    expect(waitingSheetPreselectsAll(21)).toBe(false);
    expect(waitingSheetPreselectsAll(100)).toBe(false);
  });
});

describe("partTimeOfDay", () => {
  test("morning, afternoon and evening by the hour", () => {
    expect(partTimeOfDay("08:12")).toBe("morning");
    expect(partTimeOfDay("11:59")).toBe("morning");
    expect(partTimeOfDay("12:00")).toBe("afternoon");
    expect(partTimeOfDay("17:59")).toBe("afternoon");
    expect(partTimeOfDay("18:00")).toBe("evening");
    expect(partTimeOfDay("23:30")).toBe("evening");
  });

  test("no time at all: null, never a guess", () => {
    expect(partTimeOfDay(null)).toBeNull();
  });
});

describe("splitIntoParts", () => {
  test("a long day with three real gaps becomes three parts", () => {
    const photos = [
      { id: "a1", takenAt: T("06:02"), lat: 47.0, lon: 8.0 },
      { id: "a2", takenAt: T("06:40"), lat: 47.01, lon: 8.0 },
      { id: "a3", takenAt: T("07:40"), lat: 47.02, lon: 8.0 },
      { id: "b1", takenAt: T("11:20"), lat: 47.3, lon: 8.3 },
      { id: "b2", takenAt: T("11:45"), lat: 47.31, lon: 8.3 },
      { id: "b3", takenAt: T("12:05"), lat: 47.32, lon: 8.3 },
      { id: "c1", takenAt: T("16:15"), lat: 47.5, lon: 8.5 },
      { id: "c2", takenAt: T("17:00"), lat: 47.51, lon: 8.5 },
      { id: "c3", takenAt: T("18:30"), lat: 47.52, lon: 8.5 },
    ];
    const { parts } = splitIntoParts(photos);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({ ids: ["a1", "a2", "a3"], from: "06:02", to: "07:40" });
    expect(parts[1]).toMatchObject({ ids: ["b1", "b2", "b3"], from: "11:20", to: "12:05" });
    expect(parts[2]).toMatchObject({ ids: ["c1", "c2", "c3"], from: "16:15", to: "18:30" });
    expect(parts[0].gapBeforeMinutes).toBeNull();
    expect(parts[1].gapBeforeMinutes).toBeGreaterThan(180);
  });

  test("a dense day with no real gap stays one part", () => {
    const photos = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      takenAt: `2026-06-22T${String(9 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 10).padStart(2, "0")}:00`,
      lat: 47 + i * 0.001,
      lon: 8,
    }));
    const { parts } = splitIntoParts(photos);
    expect(parts).toHaveLength(1);
    expect(parts[0].ids).toHaveLength(8);
  });

  test("undated photographs never form their own part; they join the first", () => {
    const photos = [
      { id: "u1" },
      { id: "u2" },
      { id: "a1", takenAt: T("06:00"), lat: 47, lon: 8 },
      { id: "a2", takenAt: T("06:10"), lat: 47.001, lon: 8 },
      { id: "b1", takenAt: T("12:00"), lat: 47.3, lon: 8.3 },
      { id: "b2", takenAt: T("12:10"), lat: 47.301, lon: 8.3 },
    ];
    const { parts } = splitIntoParts(photos);
    expect(parts).toHaveLength(2);
    expect(parts[0].ids).toEqual(["u1", "u2", "a1", "a2"]);
    expect(parts[1].ids).toEqual(["b1", "b2"]);
  });

  test("all photographs undated: one part, no times", () => {
    const { parts } = splitIntoParts([{ id: "x" }, { id: "y" }]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ ids: ["x", "y"], from: null, to: null, gapBeforeMinutes: null, kmBefore: null });
  });

  test("more than four real clusters are merged down to four", () => {
    const photos: { id: string; takenAt: string; lat: number; lon: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const h = 6 + i * 4;
      photos.push({ id: `${i}a`, takenAt: `2026-06-22T${String(h).padStart(2, "0")}:00:00`, lat: 47 + i, lon: 8 + i });
      photos.push({ id: `${i}b`, takenAt: `2026-06-22T${String(h).padStart(2, "0")}:10:00`, lat: 47 + i + 0.001, lon: 8 + i });
    }
    const { parts } = splitIntoParts(photos);
    expect(parts.length).toBeLessThanOrEqual(4);
    // Every photograph still accounted for, exactly once.
    expect(parts.flatMap((p) => p.ids).sort()).toEqual(photos.map((p) => p.id).sort());
  });

  test("a gap over 60 minutes but under 2 km does not split", () => {
    const photos = [
      { id: "a1", takenAt: T("09:00"), lat: 47, lon: 8 },
      { id: "a2", takenAt: T("10:30"), lat: 47.001, lon: 8.001 },
    ];
    const { parts } = splitIntoParts(photos);
    expect(parts).toHaveLength(1);
  });

  test("a gap over 60 minutes and over 2 km does split", () => {
    // Two photographs on each side, so the resulting parts are not
    // themselves a lone photograph the "no part under two" rule would merge
    // back together — isolating the distance/time rule being tested here.
    const photos = [
      { id: "a1", takenAt: T("09:00"), lat: 47.0, lon: 8.0 },
      { id: "a2", takenAt: T("09:05"), lat: 47.001, lon: 8.0 },
      { id: "b1", takenAt: T("10:30"), lat: 47.03, lon: 8.0 }, // ~3.3km from a2
      { id: "b2", takenAt: T("10:35"), lat: 47.031, lon: 8.0 },
    ];
    const { parts } = splitIntoParts(photos);
    expect(parts).toHaveLength(2);
    expect(parts[0].ids).toEqual(["a1", "a2"]);
    expect(parts[1].ids).toEqual(["b1", "b2"]);
  });

  test("a gap over 3 hours splits even with no distance at all", () => {
    const photos = [
      { id: "a1", takenAt: T("09:00"), lat: 47, lon: 8 },
      { id: "a2", takenAt: T("12:05"), lat: 47, lon: 8 },
    ];
    const { parts } = splitIntoParts(photos);
    expect(parts).toHaveLength(2);
  });

  test("no coordinates at all: the 90-minute rule alone decides", () => {
    const stays = splitIntoParts([
      { id: "a1", takenAt: T("09:00") },
      { id: "a2", takenAt: T("09:05") },
      { id: "b1", takenAt: T("10:20") },
      { id: "b2", takenAt: T("10:25") },
    ]);
    expect(stays.parts).toHaveLength(1);
    const splits = splitIntoParts([
      { id: "a1", takenAt: T("09:00") },
      { id: "a2", takenAt: T("09:05") },
      { id: "b1", takenAt: T("10:40") },
      { id: "b2", takenAt: T("10:45") },
    ]);
    expect(splits.parts).toHaveLength(2);
    expect(splits.parts[0].ids).toEqual(["a1", "a2"]);
    expect(splits.parts[1].ids).toEqual(["b1", "b2"]);
  });

  test("a lone photograph isolated by gaps under 3h on both sides is folded into its nearer neighbour", () => {
    const photos = [
      { id: "a1", takenAt: T("08:00"), lat: 47, lon: 8 },
      { id: "a2", takenAt: T("08:05"), lat: 47.001, lon: 8 },
      // 80 minutes and ~3km from a2: a real split (>60min & >2km) but under
      // the 3h "stays alone regardless" threshold either side.
      { id: "mid", takenAt: T("09:25"), lat: 47.03, lon: 8 },
      { id: "b1", takenAt: T("10:45"), lat: 47.06, lon: 8 },
      { id: "b2", takenAt: T("10:50"), lat: 47.061, lon: 8 },
    ];
    const { parts } = splitIntoParts(photos);
    expect(parts.every((p) => p.ids.length >= 2)).toBe(true);
    expect(parts.flatMap((p) => p.ids).sort()).toEqual(["a1", "a2", "b1", "b2", "mid"].sort());
  });

  test("a lone photograph isolated by a gap over 3h stays its own part", () => {
    const photos = [
      { id: "a1", takenAt: T("08:00"), lat: 47, lon: 8 },
      { id: "a2", takenAt: T("08:05"), lat: 47.001, lon: 8 },
      { id: "mid", takenAt: T("12:00"), lat: 50, lon: 20 },
      { id: "b1", takenAt: T("16:00"), lat: 10, lon: 10 },
      { id: "b2", takenAt: T("16:05"), lat: 10.001, lon: 10 },
    ];
    const { parts } = splitIntoParts(photos);
    expect(parts).toHaveLength(3);
    expect(parts[1].ids).toEqual(["mid"]);
  });

  test("empty input is an empty list of parts", () => {
    expect(splitIntoParts([])).toEqual({ parts: [] });
  });
});
