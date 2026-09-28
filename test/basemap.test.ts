import { describe, expect, test } from "vitest";
import { basemapFor } from "@/lib/basemap";
import { frameRoute } from "@/lib/mapFrame";
import { paddedFrameBox, placesInBox } from "@/lib/ingest/geo";
import { peaksInBox } from "@/lib/ingest/peaks";

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

  test("coordinator review 2026-09-24 — never a section of a populated place (GeoNames PPLX)", () => {
    // Budapest's own numbered kerület and named districts — real GeoNames
    // rows, all PPLX, all inside a box that also contains Budapest itself.
    const found = placesInBox(47.42, 18.95, 47.55, 19.15, 2000);
    const districtLike = found.filter((p) => /kerület|Kelenföld|Óbuda/i.test(p.name));
    expect(districtLike).toHaveLength(0);
  });
});

describe("B2212 — the worldwide peak index", () => {
  test("finds real peaks, tallest first, all inside the box", () => {
    // Wetterstein range, Bavaria/Tyrol.
    const found = peaksInBox(47.34, 10.86, 47.51, 11.06, 100);
    expect(found.length).toBeGreaterThan(0);
    const metres = found.map((p) => p.metres);
    expect([...metres].sort((a, b) => b - a)).toEqual(metres);
    for (const p of found) {
      expect(p.lat).toBeGreaterThanOrEqual(47.34);
      expect(p.lat).toBeLessThanOrEqual(47.51);
      expect(p.lng).toBeGreaterThanOrEqual(10.86);
      expect(p.lng).toBeLessThanOrEqual(11.06);
    }
    expect(found.map((p) => p.name)).toContain("Zugspitze");
  });

  test("an empty stretch of ocean has no peaks in it", () => {
    expect(peaksInBox(-40, -140, -38, -138, 10)).toEqual([]);
  });
});

describe("B2211 — paddedFrameBox pads proportionally, not by a fixed number of degrees", () => {
  test("a close pair of points gets a close box", () => {
    const box = paddedFrameBox([
      { lat: 47.4979, lng: 19.0402 },
      { lat: 47.42, lng: 18.99 },
    ]);
    // The fixed pad B2211 replaced was 3-5 degrees on every side — proof the
    // new box stays within a couple of degrees for a route a few km wide.
    expect(box.north - box.south).toBeLessThan(2);
    expect(box.east - box.west).toBeLessThan(2);
  });

  test("a continental pair of points gets a wide box", () => {
    const box = paddedFrameBox([
      { lat: 10.78, lng: 106.7 },
      { lat: 31.22, lng: 121.54 },
    ]);
    expect(box.north - box.south).toBeGreaterThan(10);
  });
});

/**
 * B2491 review. Russia's own border ring crosses the antimeridian, and the
 * bake (`scripts/build-mapdata.mjs`'s `ringToShape`) used to cut it into
 * subpaths there and close each one with a plain `Z` — an edge from that
 * fragment's own last point back to its own first, which is rarely anywhere
 * near it. `lib/mapClip.ts`'s Sutherland–Hodgman clip then faithfully
 * clipped *that* chord too, and the visible result — found live, on
 * `/severin/trips` — was a short diagonal line from Kamchatka to whichever
 * corner of the frame's box the chord happened to cross.
 *
 * The fix unwraps the ring instead of cutting it (`unwrapLngs`/`shiftLng`
 * in the bake), so it reaches this test as an ordinary, non-self-crossing
 * polygon and the *existing* clip needs no change of its own. This asserts
 * the outcome directly, against the real committed bundle, at the actual
 * frame the bug was found on: no border/lake path this close to Russia's
 * Far East has an edge — anywhere in it, including the one from its own
 * last point back to its first — longer than a real coastline vertex
 * spacing at this resolution ever is.
 */
describe("B2491 review — no antimeridian chord near Russia's Far East", () => {
  /** Roughly Sea of Japan to Kamchatka — the region the wedge/line reached
   * for on `/severin/trips`'s "Alle" and "Europe" (sic — the frame's own
   * right edge) views. */
  const kamchatka = frameRoute([
    { lat: 43, lng: 135 },
    { lat: 60, lng: 165 },
  ]);

  function maxEdgeSpan(paths: readonly string[]): number {
    let max = 0;
    for (const d of paths) {
      for (const sub of d.split(/(?=M)/)) {
        const pts = [...sub.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [
          Number(m[1]),
          Number(m[2]),
        ]);
        if (pts.length < 2) continue;
        for (let i = 1; i < pts.length; i++) max = Math.max(max, Math.abs(pts[i][0] - pts[i - 1][0]));
        // The closing edge — the one a naive per-fragment `Z` got wrong.
        max = Math.max(max, Math.abs(pts[0][0] - pts[pts.length - 1][0]));
      }
    }
    return max;
  }

  test("no border, lake or river path near Russia's Far East has a chord-sized edge", () => {
    const map = basemapFor(kamchatka)!;
    expect(map).not.toBeNull();
    // A real coastline vertex at this resolution is metres to a few km apart
    // — nowhere close to the hundreds-of-units chord an antimeridian
    // artifact draws. 50 units is generously below "chord", generously
    // above "adjacent vertex".
    expect(maxEdgeSpan(map.borders)).toBeLessThan(50);
    expect(maxEdgeSpan(map.lakes)).toBeLessThan(50);
    expect(maxEdgeSpan(map.rivers)).toBeLessThan(50);
  });

  test("a frame spanning the antimeridian itself still draws a clean coastline", () => {
    // Alaska to Chukotka — a frame that straddles the seam directly, the
    // case the shifted duplicate copies (`shiftLng`) exist for.
    const strait = frameRoute([
      { lat: 60, lng: -175 },
      { lat: 68, lng: 175 },
    ]);
    const map = basemapFor(strait)!;
    expect(map).not.toBeNull();
    expect(maxEdgeSpan(map.borders)).toBeLessThan(50);
  });
});
