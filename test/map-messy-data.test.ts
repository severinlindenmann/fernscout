import { describe, expect, test } from "vitest";
import { dayAnchors } from "@/lib/map/routeAnchors";
import { withDeclaredLegs } from "@/lib/map/legMode";
import { isTooRecent, pinTooRecent, mayBridge, pinsInRegion, placeDayByDate, plausiblePin, recentCutoffDate } from "@/lib/map/mapSafety";
import { recordedSegmentsFor } from "@/lib/map/recordedSegments";
import { inHiddenStretch } from "@/lib/map/photoPins";
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
    // zoneless wall-clock, no position: 12 h margin
    expect(pinTooRecent("2026-10-10T05:00:00", "2026-10-10", false, now)).toBe(true);
    expect(pinTooRecent("2026-10-09T23:00:00", "2026-10-09", false, now)).toBe(false);
    // explicit offset: exact instant plus 2 h drift (cutoff 26 h)
    expect(pinTooRecent("2026-10-11T18:00:00+09:00", "2026-10-11", false, now)).toBe(true); // 3 h ago
    expect(pinTooRecent("2026-10-09T20:00:00+02:00", "2026-10-09", false, now)).toBe(false); // 28 h ago
    expect(pinTooRecent("2026-10-10T14:00:00+02:00", "2026-10-10", false, now)).toBe(true); // 24 h ago, inside drift
    // zoneless, read in the photo's own zone (Tokyo UTC+9, Switzerland UTC+2)
    const tokyo = { lat: 35.68, lng: 139.76 };
    const bern = { lat: 46.95, lng: 7.45 };
    // 20 h before now: 2026-10-11T12:00Z - 20h = 10-10T16:00Z = 10-11T01:00 JST
    expect(pinTooRecent("2026-10-11T01:00:00", "2026-10-11", false, now, tokyo)).toBe(true);
    // 27 h before now: 10-10T09:00Z = 18:00 JST; the 36 h rule would still hide it
    expect(pinTooRecent("2026-10-10T18:00:00", "2026-10-10", false, now, tokyo)).toBe(false);
    expect(pinTooRecent("2026-10-10T18:00:00", "2026-10-10", false, now)).toBe(true);
    // Swiss: 20 h before = 10-10T16:00Z = 18:00 CEST; 27 h = 09:00Z = 11:00 CEST
    expect(pinTooRecent("2026-10-10T18:00:00", "2026-10-10", false, now, bern)).toBe(true);
    expect(pinTooRecent("2026-10-10T11:00:00", "2026-10-10", false, now, bern)).toBe(false);
    // zone cannot be resolved: back to 36 h
    expect(pinTooRecent("2026-10-10T05:00:00", "2026-10-10", false, now, { lat: NaN, lng: NaN })).toBe(true);
    expect(pinTooRecent("2026-10-09T23:00:00", "2026-10-09", false, now, { lat: NaN, lng: NaN })).toBe(false);
    // live reader is never held back
    expect(pinTooRecent("2026-10-11T01:00:00", "2026-10-11", true, now, tokyo)).toBe(false);
    // no stamp: the 48 h day rule
    expect(pinTooRecent(undefined, "2026-10-09", false, now)).toBe(true);
    expect(pinTooRecent(undefined, "2026-10-09", true, now)).toBe(false);
  });
  test("a photo taken in a hidden stretch is withheld, whichever day it is filed under", () => {
    const stretches = [{ date: "2026-10-10", from: "14:00", to: "15:00" }];
    // inside, by the day's own entry
    expect(inHiddenStretch("2026-10-10T14:30:00", "2026-10-10", stretches)).toBe(true);
    // margin for camera drift
    expect(inHiddenStretch("2026-10-10T15:20:00", "2026-10-10", stretches)).toBe(true);
    expect(inHiddenStretch("2026-10-10T16:00:00", "2026-10-10", stretches)).toBe(false);
    // taken on the stretch's day but filed under another day's entry
    expect(inHiddenStretch("2026-10-10T14:30:00", "2026-10-11", stretches)).toBe(true);
    // a UTC stamp cannot be compared with a local wall clock: withheld on a day with a stretch
    expect(inHiddenStretch("2026-10-10T19:00:00Z", "2026-10-10", stretches)).toBe(true);
    // an offset stamp keeps its written wall clock
    expect(inHiddenStretch("2026-10-10T14:30:00+02:00", "2026-10-10", stretches)).toBe(true);
    expect(inHiddenStretch("2026-10-10T18:30:00+02:00", "2026-10-10", stretches)).toBe(false);
    // no stamp, or unreadable: withheld when the day has a stretch, free otherwise
    expect(inHiddenStretch(undefined, "2026-10-10", stretches)).toBe(true);
    expect(inHiddenStretch("2026:10:10 14:30:00", "2026-10-10", stretches)).toBe(true);
    expect(inHiddenStretch(undefined, "2026-10-12", stretches)).toBe(false);
    expect(inHiddenStretch("2026-10-10T14:30:00", "2026-10-10", [])).toBe(false);
  });

  test("a stamp that cannot be read fails closed for a week", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(pinTooRecent("2026:10:11 11:50:00", "2026-10-06", false, now)).toBe(true);
    expect(pinTooRecent("garbage", "2026-10-06", false, now)).toBe(true);
    expect(pinTooRecent("garbage", "2026-10-03", false, now)).toBe(false);
    expect(pinTooRecent("2026-10-11 11:50:00", "2026-10-11", false, now, { lat: 35.68, lng: 139.69 })).toBe(true);
    expect(pinTooRecent("garbage", "2026-10-11", true, now)).toBe(false);
  });
});
