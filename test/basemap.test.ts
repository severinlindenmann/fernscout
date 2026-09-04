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

describe("the basemap for an inland trip", () => {
  /**
   * Asserted rather than skipped on, which is the B179 half this file carries.
   *
   * These used to hang off `describe.skipIf(!built)`, and `built` was
   * `basemapFor(...) !== null` — a condition that is false both when the
   * bundle was never built and when reading it *failed*. `lib/mapdata/
   * basemap.json.gz` is committed, so in a checkout it is never legitimately
   * absent, and the skip only ever fired for the second reason: one vitest run
   * in three reported green with seven map assertions quietly missing. A run
   * that cannot read the bundle now says so here, once, in a sentence.
   */
  test("the committed bundle loaded — everything below depends on it", () => {
    expect(basemapFor(frameRoute(alps))).not.toBeNull();
  });

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

  /**
   * B177: what all of that costs a reader on mobile data.
   *
   * Every shape whose bounding box grazed the frame used to travel whole, so
   * four stops inside 68 km were drawn on 518,867 bytes of basemap — 465,472
   * of it seven country polygons, most of them a thousand kilometres past the
   * edge of a frame 186 km wide. Clipped to the padded box (lib/mapClip.ts)
   * the same map is 64,616. The ceiling is generous against that measurement
   * rather than tuned to it: it is here to fail if whole shapes ever start
   * travelling again, not to police a few kilobytes.
   */
  test("weighs kilobytes, not half a megabyte", () => {
    expect(Buffer.byteLength(JSON.stringify(map))).toBeLessThan(120_000);
  });

  /**
   * Countries are filled *and* stroked — the fill is the land — so a clipped
   * polygon has to come back closed or the sea turns green, while a river cut
   * at the same edge must not be closed into a loop.
   */
  test("keeps filled shapes closed and stroked lines open", () => {
    for (const d of [...map.borders, ...map.lakes, ...map.glaciers, ...map.relief]) {
      expect(d.startsWith("M")).toBe(true);
      expect(d.trimEnd().endsWith("Z")).toBe(true);
    }
    for (const d of [...map.rivers, ...map.roads, ...map.railroads, ...map.admin1]) {
      expect(d).not.toContain("Z");
    }
  });

  /**
   * And the cut is to the *padded* box, not the frame: the artificial edges a
   * clip leaves behind are stroked as though a border ran there, so they have
   * to sit outside anything a zoom can show. See PAD_FRACTION in lib/basemap.ts.
   */
  test("cuts to the padded box, so no cut edge lands inside the frame", () => {
    const frame = frameRoute(alps);
    // The box lib/basemap.ts clips to, in the bundle's uncorrected units.
    const box = {
      x0: (frame.x - frame.w * 0.5) / frame.lngScale,
      x1: (frame.x + frame.w * 1.5) / frame.lngScale,
      y0: frame.y - frame.h * 0.5,
      y1: frame.y + frame.h * 1.5,
    };
    // One grid cell of slack, and no more: coordinates are written to two
    // decimals (a 400 m grid, scripts/build-mapdata.mjs), so a point cut
    // exactly on the box rounds up to half a cell past it. Measured worst case
    // on this frame: 0.0049 units, 198 m, against a frame 4.64 units wide.
    const slack = 0.01;
    let outside = 0;
    for (const layer of [map.borders, map.lakes, map.rivers, map.roads, map.railroads]) {
      for (const d of layer) {
        for (const pair of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
          const x = Number(pair[1]);
          const y = Number(pair[2]);
          if (
            x < box.x0 - slack ||
            x > box.x1 + slack ||
            y < box.y0 - slack ||
            y > box.y1 + slack
          ) {
            outside++;
          }
        }
      }
    }
    expect(outside).toBe(0);
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
