import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import { basemapFor, basemapMemoSize, clearBasemapCache, localBasemaps } from "@/lib/basemap";
import { frameRoute } from "@/lib/mapFrame";

/**
 * `basemapFor` keeps the clips it has made, keyed by frame, so a story page
 * no longer re-cuts the 25 MB bundle on every render. What has to hold for
 * that to be safe: one frame is one answer; a different frame or a different
 * opt-in layer is a different one; the answer cannot be written to by the
 * caller it is handed to; and it goes when the bundle it came from goes —
 * including the retry path B179 put in, where a read that failed is tried
 * again on the next call.
 */

/** alps-2024's four stops, as the other map tests frame them. */
const ALPS = [
  { lat: 46.1161, lng: 8.2939 },
  { lat: 46.5614, lng: 8.3372 },
  { lat: 46.7297, lng: 8.4444 },
  { lat: 46.6364, lng: 8.5942 },
];

beforeEach(() => clearBasemapCache());
afterEach(() => {
  vi.restoreAllMocks();
  clearBasemapCache();
});

describe("the basemap memo", () => {
  test("one frame is one clip, however it is framed again", () => {
    const first = basemapFor(frameRoute(ALPS));
    expect(first).not.toBeNull();
    // A fresh `Frame` object with the same numbers — the key is the frame's
    // values, not its identity, so a second page asking for the same trip
    // shares the clip.
    expect(basemapFor(frameRoute([...ALPS]))).toBe(first);
  });

  test("a different frame, or an opt-in layer, is a different clip", () => {
    const whole = basemapFor(frameRoute(ALPS));
    const one = basemapFor(frameRoute([ALPS[0]]));
    const withParks = basemapFor(frameRoute(ALPS), { worldParks: true });
    expect(one).not.toBe(whole);
    expect(withParks).not.toBe(whole);
    expect(basemapFor(frameRoute(ALPS), { worldParks: true })).toBe(withParks);
  });

  test("is frozen outside production, so a caller cannot redraw another page's map", () => {
    const map = basemapFor(frameRoute(ALPS))!;
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.borders)).toBe(true);
    expect(Object.isFrozen(map.towns)).toBe(true);
    for (const town of map.towns) expect(Object.isFrozen(town)).toBe(true);
    expect(() => (map.borders as string[]).push("M0 0")).toThrow(TypeError);
  });

  test("is emptied with the bundle, and a fresh clip is equal to the old one", () => {
    const before = basemapFor(frameRoute(ALPS));
    expect(basemapMemoSize()).toBeGreaterThan(0);
    clearBasemapCache();
    expect(basemapMemoSize()).toBe(0);
    const after = basemapFor(frameRoute(ALPS));
    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });

  test("holds nothing while the bundle cannot be read, and clips again once it can", () => {
    const real = fs.readFileSync.bind(fs);
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((file: unknown, ...rest: unknown[]) => {
      if (typeof file === "string" && file.endsWith("basemap.json.gz")) {
        throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
      }
      return (real as (...args: unknown[]) => unknown)(file, ...rest);
    }) as typeof fs.readFileSync);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(basemapFor(frameRoute(ALPS))).toBeNull();
    expect(basemapMemoSize()).toBe(0);

    spy.mockRestore();
    expect(basemapFor(frameRoute(ALPS))).not.toBeNull();
    expect(basemapMemoSize()).toBe(1);
  });

  test("is bounded, dropping the least recently used frame first", () => {
    const keep = frameRoute(ALPS);
    const kept = basemapFor(keep);
    // Town-scale frames along a line of latitude: every one a distinct key.
    const points = Array.from({ length: 300 }, (_, i) => ({ lat: 47, lng: -120 + i * 0.5 }));
    let first: ReturnType<typeof basemapFor> = null;
    for (const [i, point] of points.entries()) {
      const clip = basemapFor(frameRoute([point]));
      if (i === 0) first = clip;
      // Asked again partway through, so it is recent when the cap is reached.
      if (i === 200) expect(basemapFor(keep)).toBe(kept);
    }
    expect(basemapMemoSize()).toBe(256);
    expect(basemapFor(keep)).toBe(kept);
    // The very first frame went long ago: asked again, it is clipped afresh.
    const again = basemapFor(frameRoute([points[0]]));
    expect(basemapMemoSize()).toBe(256);
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });

  test("localBasemaps shares the clips and still returns a record of its own", () => {
    const a = localBasemaps(ALPS);
    const b = localBasemaps(ALPS);
    expect(a).not.toBe(b);
    for (const key of Object.keys(a)) expect(b[key]).toBe(a[key]);
  });
});
