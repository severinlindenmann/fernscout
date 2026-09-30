import { describe, expect, test } from "vitest";
import { spikeIndices, spikeJump } from "@/lib/gps/spikes";

/**
 * B2568 — GPS spikes like the 30 Sep one (a stale fix 1.44 km behind the real
 * one a second later) set aside rather than drawn, without also catching a real
 * train or flight's own genuinely high speed.
 */
describe("spikeIndices", () => {
  test("the 30 Sep shape is flagged — a one-fix out-and-back", () => {
    const t0 = Date.parse("2026-09-30T08:03:58Z");
    const fixes = [
      { t: t0, lat: 47.0, lon: 8.0 },
      // ~1.44 km north of the point either side of it, one second later.
      { t: t0 + 1_000, lat: 47.013, lon: 8.0 },
      { t: t0 + 2_000, lat: 47.0, lon: 8.0 },
    ];
    expect(spikeIndices(fixes)).toEqual(new Set([1]));
  });

  test("the real 30 Sep sequence: the stale 08:03:58 fix is set aside, not the real one a second later", () => {
    // Distances along one road as measured from the stored fixes (km from
    // the 07:58:58 fix): 08:03:58 sat 1.44 km behind the 08:03:59 fix it
    // preceded by one second; the real line runs 0 → 7.15 → 7.49 → 7.79 km.
    const t0 = Date.parse("2026-09-30T05:58:58Z");
    const KM = 1 / 111.2; // degrees of latitude per km
    const at = (sec: number, km: number) => ({ t: t0 + sec * 1000, lat: 47 + km * KM, lon: 8 });
    const fixes = [at(0, 0), at(300, 5.71), at(301, 7.15), at(314, 7.49), at(325, 7.79)];
    expect(spikeIndices(fixes)).toEqual(new Set([1]));
    const jump = spikeJump(fixes, 1);
    expect(jump?.seconds).toBe(1);
    expect(jump?.km).toBeCloseTo(1.44, 1);
  });

  test("a densely sampled flight (a fix every 20 s at 850 km/h) is not flagged", () => {
    const t0 = Date.parse("2026-09-30T08:00:00Z");
    const KM = 1 / 111.2;
    const fixes = Array.from({ length: 8 }, (_, i) => ({ t: t0 + i * 20_000, lat: 47 + ((850 / 3600) * 20 * i) * KM, lon: 8 }));
    expect(spikeIndices(fixes).size).toBe(0);
  });

  test("a high-speed train sampled every 10 s at 320 km/h is not flagged", () => {
    const t0 = Date.parse("2026-09-30T08:00:00Z");
    const KM = 1 / 111.2;
    const fixes = Array.from({ length: 8 }, (_, i) => ({ t: t0 + i * 10_000, lat: 47 + ((320 / 3600) * 10 * i) * KM, lon: 8 }));
    expect(spikeIndices(fixes).size).toBe(0);
  });

  test("a stale 'last known position' right after a real fix: the stale one goes, not the real one", () => {
    // P: somewhere 1.4 km north, ten hours earlier. H: the real fix. X: one
    // second after H, repeating P's old position. Then a walk south from H.
    const KM = 1 / 111.2;
    const t0 = Date.parse("2026-09-30T06:00:00Z");
    const fixes = [
      { t: t0 - 10 * 3_600_000, lat: 47 + 1.4 * KM, lon: 8 },
      { t: t0, lat: 47, lon: 8 },
      { t: t0 + 1_000, lat: 47 + 1.4 * KM, lon: 8 },
      ...Array.from({ length: 6 }, (_, i) => ({ t: t0 + (i + 1) * 30_000, lat: 47 - (i + 1) * 0.04 * KM, lon: 8 })),
    ];
    expect(spikeIndices(fixes)).toEqual(new Set([2]));
  });

  test("a real train at 250 km/h, with sparse points, is not flagged", () => {
    const t0 = Date.parse("2026-09-30T08:00:00Z");
    // One fix every 5 minutes, ~20.8 km apart along a line — 250 km/h.
    const fixes = Array.from({ length: 6 }, (_, i) => ({
      t: t0 + i * 5 * 60_000,
      lat: 47.0 + i * 0.1875, // ~20.8 km per step
      lon: 8.0,
    }));
    expect(spikeIndices(fixes).size).toBe(0);
  });

  test("a real flight at 800 km/h, with sparse points, is not flagged", () => {
    const t0 = Date.parse("2026-09-30T08:00:00Z");
    // One fix every 10 minutes, ~133 km apart — 800 km/h.
    const fixes = Array.from({ length: 6 }, (_, i) => ({
      t: t0 + i * 10 * 60_000,
      lat: 47.0 + i * 1.2,
      lon: 8.0,
    }));
    expect(spikeIndices(fixes).size).toBe(0);
  });

  test("endpoints are never flagged — no neighbour on one side", () => {
    expect(spikeIndices([])).toEqual(new Set());
    expect(spikeIndices([{ t: 0, lat: 0, lon: 0 }])).toEqual(new Set());
    // Two fixes: neither has both a before and an after.
    expect(spikeIndices([{ t: 0, lat: 0, lon: 0 }, { t: 1000, lat: 10, lon: 10 }])).toEqual(new Set());
  });

  test("a real, if brief, fast trip between close-together neighbours is not flagged — both hops must be implausible", () => {
    const t0 = Date.parse("2026-09-30T08:00:00Z");
    // A quick errand: out 50 m and back in a normal walking time, nothing
    // close to the sane-speed ceiling either way.
    const fixes = [
      { t: t0, lat: 47.0, lon: 8.0 },
      { t: t0 + 30_000, lat: 47.00045, lon: 8.0 },
      { t: t0 + 60_000, lat: 47.0, lon: 8.0 },
    ];
    expect(spikeIndices(fixes).size).toBe(0);
  });
});

describe("spikeJump", () => {
  test("reports the km and seconds from the previous fix", () => {
    const t0 = Date.parse("2026-09-30T08:03:58Z");
    const fixes = [
      { t: t0, lat: 47.0, lon: 8.0 },
      { t: t0 + 1_000, lat: 47.013, lon: 8.0 },
      { t: t0 + 2_000, lat: 47.0, lon: 8.0 },
    ];
    const jump = spikeJump(fixes, 1);
    expect(jump?.seconds).toBe(1);
    expect(jump?.km).toBeCloseTo(1.446, 2);
  });

  test("undefined at index 0 — nothing to jump from", () => {
    expect(spikeJump([{ t: 0, lat: 0, lon: 0 }], 0)).toBeUndefined();
  });
});
