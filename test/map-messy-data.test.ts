import { describe, expect, test } from "vitest";
import { dayAnchors } from "@/lib/map/routeAnchors";
import { withDeclaredLegs } from "@/lib/map/legMode";
import { isTooRecent, pinTooRecent, mayBridge, pinsInRegion, placeDayByDate, plausiblePin, recentCutoffDate } from "@/lib/map/mapSafety";
import { recordedSegmentsFor } from "@/lib/map/recordedSegments";
import { buildTripFrame, linesForRegion, type MapPlace } from "@/lib/map/tripFrame";
import type { Day, Entry } from "@/lib/types";

const place = (day: number, lat: number, lng: number): MapPlace => ({ day, date: `2026-10-0${day}`, lat, lng, name: `P${day}` });

describe("B-2980 messy data", () => {
  test("S10 a merged stay draws every one of its days' lines under the place's number", () => {
    const days = [{ date: "2026-10-01" }, { date: "2026-10-02" }, { date: "2026-10-03" }];
    const byDate = new Map(days.map((d, i) => [d.date, i + 1] as const));
    const m = placeDayByDate(days, [{ firstDate: "2026-10-01", lastDate: "2026-10-02" }, { firstDate: "2026-10-03", lastDate: "2026-10-03" }], byDate);
    expect([...m]).toEqual([["2026-10-01", 1], ["2026-10-02", 1], ["2026-10-03", 3]]);
    const segs = recordedSegmentsFor([{ date: "2026-10-02", points: [[46, 7], [46.01, 7.01]] }], m);
    expect(segs).toHaveLength(1);
    expect(segs[0].day).toBe(1);
  });

  test("S13 a gap is bridged only when short and never across a cut", () => {
    const a = { date: "2026-10-01", points: [[46, 7], [46.001, 7.001]] as [number, number][] };
    const b = { date: "2026-10-01", points: [[46.002, 7.002], [46.003, 7.003]] as [number, number][] };
    const days = new Map([["2026-10-01", 1]]);
    expect(recordedSegmentsFor([a, b], days).filter((s) => s.gap)).toHaveLength(1);
    expect(recordedSegmentsFor([{ ...a, cutAfter: true }, { ...b, cutBefore: true }], days).filter((s) => s.gap)).toHaveLength(0);
    expect(mayBridge({ lat: 46, lng: 7 }, { lat: 46.5, lng: 7 }, true)).toBe(false);
  });

  test("S11 outlier pins are dropped and never stretch the region", () => {
    const route = [{ lat: 46.5, lng: 8 }];
    expect(plausiblePin({ lat: 0, lng: 0 }, route)).toBe(false);
    expect(plausiblePin({ lat: 46.6, lng: 8.1 }, route)).toBe(true);
    expect(plausiblePin({ lat: 13.7, lng: 100.5 }, route)).toBe(false);
    expect(plausiblePin({ lat: 13.7, lng: 100.5 }, [])).toBe(true);
    const pins = [{ lat: 46.6, lng: 8.1 }, { lat: 13.7, lng: 100.5 }];
    expect(pinsInRegion(pins, route)).toEqual([pins[0]]);
  });

  test("S1/S9 lines are kept for every region, filtered at render", () => {
    const frame = buildTripFrame([place(1, 47.4, 8.5), place(2, 47.5, 8.6), place(3, 13.7, 100.5), place(4, 13.8, 100.6)]);
    // Main region is a tie -> first; the other region's join is still there in allLines.
    expect(frame.allLines.length).toBeGreaterThan(frame.lines.length);
    const other = linesForRegion(frame.allLines, new Set([3, 4]), false);
    expect(other.map((l) => `${l.fromDay}-${l.toDay}`)).toEqual(["3-4"]);
    expect(linesForRegion(frame.allLines, new Set([3, 4]), true)).toEqual(frame.allLines);
  });

  test("S1/S9 a long recorded leg keeps its coordinates, and a line to no region is not erased", () => {
    const rec = [{ day: 1, points: [{ lat: 47, lng: 8 }, { lat: 13.7, lng: 100.5 }] }];
    const frame = buildTripFrame([place(1, 47, 8), place(2, 13.7, 100.5)], rec);
    const recorded = frame.allLines.find((l) => l.kind === "recorded");
    expect(recorded?.coords).toHaveLength(2);
    // A place tagged nowhere near the recorded line (region -1) does not remove it.
    const lone = buildTripFrame([place(1, 47, 8), place(2, 47.1, 8.1)], [{ day: 1, points: [{ lat: 10, lng: 10 }, { lat: 10.1, lng: 10.1 }] }]);
    expect(lone.lines.some((l) => l.kind === "recorded")).toBe(false); // main-region card view unchanged
    expect(lone.allLines.some((l) => l.kind === "recorded")).toBe(true);
  });

  test("S1 a declared mode goes onto the first recorded line into the day only", () => {
    const places = [place(1, 47, 8), place(2, 47.1, 8.1)];
    const lines = ["a", "b"].map(() => ({ kind: "recorded" as const, fromDay: 2, toDay: 2, coords: [{ lat: 47.1, lng: 8.1 }, { lat: 47.11, lng: 8.11 }] }));
    const out = withDeclaredLegs(lines, places, new Map([[2, "train" as const]]));
    expect(out.map((l) => l.mode)).toEqual(["train", undefined]);
  });

  test("S6/S7 photo-only days on a tracked trip still get a join", () => {
    const rec = [{ day: 1, points: [{ lat: 47, lng: 8 }, { lat: 47.01, lng: 8.01 }] }];
    const frame = buildTripFrame([place(1, 47, 8), place(2, 47.2, 8.2), place(3, 47.4, 8.4)], rec);
    const joins = frame.allLines.filter((l) => l.kind === "photo-join").map((l) => `${l.fromDay}-${l.toDay}`);
    expect(joins).toEqual(["2-3"]);
  });

  test("S4 a day with only located photos is placed from them", () => {
    const e = { slug: "s" } as unknown as Entry;
    const d = { date: "2026-10-03", entries: [e], lead: e } as Day;
    const m = dayAnchors([d], [], [{ date: "2026-10-03", lat: 46.2, lng: 7.2 }, { date: "2026-10-04", lat: 1, lng: 1 }]);
    expect(m.get("2026-10-03")).toMatchObject({ lat: 46.2, lng: 7.2 });
    expect(m.size).toBe(1);
  });

  test("S14 a day from yesterday on is withheld from a non-live reader only", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(recentCutoffDate(now)).toBe("2026-10-09");
    expect(isTooRecent("2026-10-09", false, now)).toBe(true);
    expect(isTooRecent("2026-10-08", false, now)).toBe(false);
    expect(isTooRecent("2026-10-11", true, now)).toBe(false);
  });

  test("a pin under 24 h old is withheld whatever the day date says", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(pinTooRecent("2026-10-10T20:00:00Z", "2026-10-10", false, now)).toBe(true);
    expect(pinTooRecent("2026-10-10T08:00:00Z", "2026-10-10", false, now)).toBe(false);
    // zoneless wall-clock: up to 12 h of margin
    expect(pinTooRecent("2026-10-10T05:00:00", "2026-10-10", false, now)).toBe(true);
    expect(pinTooRecent("2026-10-09T23:00:00", "2026-10-09", false, now)).toBe(false);
    // no stamp: the 48 h day rule
    expect(pinTooRecent(undefined, "2026-10-09", false, now)).toBe(true);
    expect(pinTooRecent(undefined, "2026-10-09", true, now)).toBe(false);
  });
});
