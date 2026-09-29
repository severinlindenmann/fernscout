import { describe, expect, test } from "vitest";
import { fractionForTime, gapFractions, selectionStats, timeForFraction } from "@/lib/map/rangeBar";

describe("rangeBar time <-> fraction", () => {
  test("fractionForTime clamps and maps linearly", () => {
    expect(fractionForTime(0, 0, 1000)).toBe(0);
    expect(fractionForTime(500, 0, 1000)).toBe(0.5);
    expect(fractionForTime(1000, 0, 1000)).toBe(1);
    expect(fractionForTime(-100, 0, 1000)).toBe(0);
    expect(fractionForTime(2000, 0, 1000)).toBe(1);
  });

  test("fractionForTime never divides by zero when start === end", () => {
    expect(fractionForTime(5, 5, 5)).toBe(0);
  });

  test("timeForFraction is fractionForTime's inverse", () => {
    expect(timeForFraction(0.25, 0, 1000)).toBe(250);
    expect(timeForFraction(-1, 0, 1000)).toBe(0);
    expect(timeForFraction(2, 0, 1000)).toBe(1000);
  });
});

describe("gapFractions", () => {
  test("marks only the joins gapAfter flags, as fraction pairs", () => {
    const times = [0, 100, 500, 1000];
    const gapAfter = [false, true, false];
    expect(gapFractions(times, gapAfter, 0, 1000)).toEqual([[0.1, 0.5]]);
  });

  test("no gaps means an empty list", () => {
    expect(gapFractions([0, 1000], [false], 0, 1000)).toEqual([]);
  });
});

describe("selectionStats", () => {
  const points: [number, number][] = [
    [47.0, 8.0],
    [47.01, 8.0],
    [47.02, 8.0],
  ];
  const times = [0, 1000, 2000];

  test("counts positions and sums km inside the range, inclusive", () => {
    const stats = selectionStats(points, times, [undefined, undefined, undefined], 0, 2000);
    expect(stats.positions).toBe(3);
    expect(stats.km).toBeGreaterThan(0);
  });

  test("excludes fixes outside the range", () => {
    const stats = selectionStats(points, times, [undefined, undefined, undefined], 0, 1000);
    expect(stats.positions).toBe(2);
  });

  test("mode is the shared mode when every fix in range agrees", () => {
    const stats = selectionStats(points, times, ["boat", "boat", "car"], 0, 1000);
    expect(stats.mode).toBe("boat");
  });

  test("mode is undefined when the range mixes modes or has none", () => {
    expect(selectionStats(points, times, ["boat", "car", "car"], 0, 1000).mode).toBeUndefined();
    expect(selectionStats(points, times, [undefined, undefined, undefined], 0, 1000).mode).toBeUndefined();
  });

  test("an empty range (no fixes inside) reports zero positions and km", () => {
    const stats = selectionStats(points, times, [undefined, undefined, undefined], 5000, 6000);
    expect(stats).toEqual({ positions: 0, km: 0, mode: undefined });
  });
});
