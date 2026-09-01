import { describe, expect, test } from "vitest";
import { basemapFor } from "@/lib/basemap";
import { frameRoute } from "@/lib/mapFrame";
import { placesInBox } from "@/lib/ingest/geo";

/**
 * What a frame gets to draw on.
 *
 * B46 measured the old answer and it was nothing: `lib/worldLand.json` is 110m
 * *coastline*, so Switzerland — which has none — was a blank green field at
 * every zoom. These assert the replacement actually says something about an
 * inland trip, and that it says only as much as fits.
 */

/** alps-2024: four stops inside 68 km, entirely inland. */
const alps = [
  { lat: 46.1161, lng: 8.2939 },
  { lat: 46.5614, lng: 8.3372 },
  { lat: 46.7297, lng: 8.4444 },
  { lat: 46.6364, lng: 8.5942 },
];

const built = basemapFor(frameRoute(alps)) !== null;

describe.skipIf(!built)("the basemap for an inland trip", () => {
  const map = basemapFor(frameRoute(alps))!;

  test("has borders to draw, which the coastline never did", () => {
    expect(map.borders.length).toBeGreaterThan(0);
  });

  test("has water — the thing an Alpine valley is actually full of", () => {
    expect(map.lakes.length + map.rivers.length).toBeGreaterThan(0);
  });

  test("names towns near the route", () => {
    const names = map.towns.map((t) => t.name);
    expect(names.length).toBeGreaterThan(3);
    // Somewhere in the Bernese Oberland / Ticino box the frame covers.
    expect(names.some((n) => /Thun|Sitten|Lugano|Bellinzona|Gstaad/.test(n))).toBe(true);
  });

  test("names peaks, tallest first", () => {
    expect(map.peaks.length).toBeGreaterThan(0);
    const metres = map.peaks.map((p) => p.metres ?? 0);
    expect([...metres].sort((a, b) => b - a)).toEqual(metres);
  });

  /**
   * Three peak labels once drew across each other in one illegible line. The
   * rule is that no two kept labels share a cell of the frame.
   */
  test("does not stack labels on top of each other", () => {
    const frame = frameRoute(alps);
    for (const group of [map.peaks, map.towns]) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const close =
            Math.abs(group[i].x - group[j].x) < frame.w * 0.22 &&
            Math.abs(group[i].y - group[j].y) < frame.h * 0.07;
          expect(close).toBe(false);
        }
      }
    }
  });

  test("keeps every label inside the frame it was clipped for", () => {
    const frame = frameRoute(alps);
    for (const label of [...map.peaks, ...map.towns]) {
      expect(label.x).toBeGreaterThanOrEqual(frame.x);
      expect(label.x).toBeLessThanOrEqual(frame.x + frame.w);
      expect(label.y).toBeGreaterThanOrEqual(frame.y);
      expect(label.y).toBeLessThanOrEqual(frame.y + frame.h);
    }
  });

  test("says where the data came from", () => {
    expect(map.attribution).toMatch(/Natural Earth/);
  });
});

describe("the place index answers a box as well as a point", () => {
  test("finds Swiss towns in a Swiss box, largest first", () => {
    const found = placesInBox(46.0, 6.0, 47.5, 9.5, 10);
    expect(found.length).toBeGreaterThan(0);
    const populations = found.map((p) => p.population);
    expect([...populations].sort((a, b) => b - a)).toEqual(populations);
    for (const p of found) {
      expect(p.lat).toBeGreaterThanOrEqual(46.0);
      expect(p.lat).toBeLessThanOrEqual(47.5);
      expect(p.lng).toBeGreaterThanOrEqual(6.0);
      expect(p.lng).toBeLessThanOrEqual(9.5);
    }
  });

  test("an empty stretch of ocean has nothing in it", () => {
    expect(placesInBox(-40, -140, -38, -138, 10)).toEqual([]);
  });

  test("respects the limit it is given", () => {
    expect(placesInBox(46.0, 6.0, 47.5, 9.5, 3)).toHaveLength(3);
  });
});
