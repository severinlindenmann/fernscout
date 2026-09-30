import { describe, expect, test } from "vitest";
import { buildPositionRows, gapDurationParts, resolveHiddenBy } from "@/lib/gps/positionRows";

/**
 * B2563 T5 — the Positions tab's pure row builder. `ownerDayLine` already
 * has its own store-reading tests (`test/gps-route-page.test.ts`); this file
 * is only the arithmetic and shape on top of its output, so every case here
 * is plain arrays in, rows out — no fixture, no disk.
 */

describe("buildPositionRows", () => {
  test("first row and a row right after a gap carry no distance or speed", () => {
    const rows = buildPositionRows({
      points: [
        [10, 20],
        [10.001, 20.001],
        [10.5, 20.5],
      ],
      times: [0, 60_000, 3_600_000],
      modes: [undefined, undefined, undefined],
      gapAfter: [false, true],
      placeFor: () => "Somewhere",
      hiddenByFor: () => undefined,
    });
    expect(rows).toHaveLength(4); // fix, fix, gap, fix
    expect(rows[0]).toMatchObject({ kind: "fix", index: 0, distanceM: undefined, speedKmh: undefined });
    expect(rows[1]).toMatchObject({ kind: "fix", index: 1 });
    expect((rows[1] as { distanceM?: number }).distanceM).toBeGreaterThan(0);
    expect(rows[2]).toMatchObject({ kind: "gap", afterIndex: 1, ms: 3_600_000 - 60_000 });
    // The fix straight after the gap: blank again, not measured across it.
    expect(rows[3]).toMatchObject({ kind: "fix", index: 2, distanceM: undefined, speedKmh: undefined });
  });

  test("distance and speed are computed from the previous row when there is no gap", () => {
    const rows = buildPositionRows({
      points: [
        [0, 0],
        [0, 0.01], // ~1113 m east at the equator
      ],
      times: [0, 3_600_000], // one hour later
      modes: [undefined, undefined],
      gapAfter: [false],
      placeFor: () => "Somewhere",
      hiddenByFor: () => undefined,
    });
    const second = rows[1] as { distanceM?: number; speedKmh?: number };
    expect(second.distanceM).toBeGreaterThan(1000);
    expect(second.distanceM).toBeLessThan(1200);
    expect(second.speedKmh).toBeCloseTo((second.distanceM as number) / 1000, 1);
  });

  test("hidden-by, place and mode come straight from the injected lookups", () => {
    const rows = buildPositionRows({
      points: [[1, 2]],
      times: [1_700_000_000_000],
      modes: ["on_foot" as never],
      gapAfter: [false],
      placeFor: (lat, lon) => `${lat},${lon}`,
      hiddenByFor: () => "Home",
    });
    expect(rows[0]).toMatchObject({ place: "1,2", mode: "on_foot", hiddenBy: "Home" });
  });

  test("epochSeconds is the store's own second-level instant, never re-derived", () => {
    const rows = buildPositionRows({
      points: [[1, 2]],
      times: [1_700_000_000_500],
      modes: [undefined],
      gapAfter: [false],
      placeFor: () => "x",
      hiddenByFor: () => undefined,
    });
    expect((rows[0] as { epochSeconds: number }).epochSeconds).toBe(1_700_000_001);
  });
});

describe("gapDurationParts", () => {
  test("1 h 08 min, the draft's own example", () => {
    expect(gapDurationParts(68 * 60_000)).toEqual({ hours: 1, minutes: "08" });
  });

  test("zero-pads a single-digit minute and floors extra seconds by rounding", () => {
    expect(gapDurationParts(5 * 60_000)).toEqual({ hours: 0, minutes: "05" });
  });

  test("a gap over an hour boundary carries the hour forward", () => {
    expect(gapDurationParts(125 * 60_000)).toEqual({ hours: 2, minutes: "05" });
  });
});

describe("resolveHiddenBy", () => {
  test("a private place wins over a hidden spot when a fix is inside both", () => {
    expect(resolveHiddenBy("Home", true, "Hidden spot")).toBe("Home");
  });

  test("a hidden spot shows only when no private place matched", () => {
    expect(resolveHiddenBy(undefined, true, "Hidden spot")).toBe("Hidden spot");
  });

  test("neither matched is a plain dash upstream — this returns undefined", () => {
    expect(resolveHiddenBy(undefined, false, "Hidden spot")).toBeUndefined();
  });
});
