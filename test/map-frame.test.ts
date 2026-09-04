import { describe, expect, test } from "vitest";
import {
  KM_PER_UNIT,
  frameRoute,
  frameSpanKm,
  kmBetween,
  kmForUnits,
  place,
  unitsForKm,
} from "@/lib/mapFrame";
import { MAP_VIEWBOX } from "@/lib/mapProjection.mjs";

/**
 * B46. Every map framed its route by padding the bounding box with a constant
 * 70×55 viewBox units — 5,600 × 4,400 km — so a trip smaller than a country
 * was drawn as a dot on a continent.
 *
 * The fixtures are the demo content, because they are the cases that were
 * actually wrong: `alps-2024` is four stops inside 68 km, `japan-2027` is eight
 * planned stops down the length of Japan, and `asia-2023` crosses countries.
 */

/** alps-2024, from content/example/trips/alps-2024/entries. */
const alps = [
  { lat: 46.1161, lng: 8.2939 }, // Domodossola
  { lat: 46.5614, lng: 8.3372 }, // Grimsel Pass
  { lat: 46.7297, lng: 8.4444 }, // Susten Pass
  { lat: 46.6364, lng: 8.5942 }, // Andermatt
];

/** japan-2027, first and last of the planned route. */
const japan = [
  { lat: 33.5904, lng: 130.4017 }, // Fukuoka
  { lat: 43.0618, lng: 141.3545 }, // Sapporo
];

describe("framing a route", () => {
  test("a four-day drive is framed on the drive, not on a continent", () => {
    const frame = frameRoute(alps);
    // The trip itself is about 68 km north to south. Before B46 this frame was
    // 5,650 km across; anything of that order means the padding is still fixed.
    expect(frameSpanKm(frame)).toBeLessThan(250);
    // And not so tight that the outermost stop sits on the border.
    expect(frameSpanKm(frame)).toBeGreaterThan(80);
  });

  test("every stop is inside the frame, on every fixture", () => {
    for (const route of [alps, japan, [alps[0]]]) {
      const frame = frameRoute(route);
      for (const point of route) {
        const [x, y] = place(frame, point);
        expect(x).toBeGreaterThanOrEqual(frame.x);
        expect(x).toBeLessThanOrEqual(frame.x + frame.w);
        expect(y).toBeGreaterThanOrEqual(frame.y);
        expect(y).toBeLessThanOrEqual(frame.y + frame.h);
      }
    }
  });

  /**
   * The degenerate case, and the one that produced the old behaviour in its
   * purest form: one point has a bounding box of zero extent, so padding
   * proportional to it is zero too.
   */
  test("a single stop gets a map rather than a point", () => {
    const frame = frameRoute([alps[0]]);
    expect(frame.w).toBeGreaterThan(0);
    expect(frame.h).toBeGreaterThan(0);
    expect(frameSpanKm(frame)).toBeGreaterThan(5);
    expect(frameSpanKm(frame)).toBeLessThan(100);
  });

  test("a long route still frames the whole of it", () => {
    const frame = frameRoute(japan);
    // Fukuoka to Sapporo is about 1,400 km apart; the frame has to hold it.
    expect(frameSpanKm(frame)).toBeGreaterThan(1400);
    expect(frameSpanKm(frame)).toBeLessThan(6000);
  });

  test("no route at all frames the whole world", () => {
    const frame = frameRoute([]);
    expect(frame).toEqual({
      x: 0,
      y: 0,
      w: MAP_VIEWBOX.width,
      h: MAP_VIEWBOX.height,
      lngScale: 1,
    });
  });

  /**
   * B265. A day written without coordinates still gets a `Place` — `lat` and
   * `lng` are optional on an entry, and `getPlaces` copies them through
   * unchecked — so `lat: undefined` reached `Math.min`/`Math.max` here and
   * `Math.max(0.2, NaN)` came out `NaN`, not the 0.2 floor. That poisoned
   * every field of the frame — viewBox, `scale(…)` transform, all of it —
   * which is why the console showed hundreds of identical NaN errors rather
   * than one.
   */
  describe("a point with no coordinates", () => {
    test("undefined lat is dropped rather than poisoning the frame", () => {
      const points = [...alps, { lat: undefined as unknown as number, lng: 8.5 }];
      const frame = frameRoute(points);
      expect(Number.isFinite(frame.x)).toBe(true);
      expect(Number.isFinite(frame.y)).toBe(true);
      expect(Number.isFinite(frame.w)).toBe(true);
      expect(Number.isFinite(frame.h)).toBe(true);
      expect(Number.isFinite(frame.lngScale)).toBe(true);
      // And it frames the same as the valid points alone — the invalid one
      // contributed nothing rather than something wrong.
      expect(frame).toEqual(frameRoute(alps));
    });

    test("a non-numeric lat, hand-written into frontmatter, is dropped the same way", () => {
      const points = [...alps, { lat: Number("north"), lng: 8.5 }];
      const frame = frameRoute(points);
      expect(Number.isFinite(frame.lngScale)).toBe(true);
      expect(frame).toEqual(frameRoute(alps));
    });

    test("a list that is entirely invalid frames the whole world", () => {
      const points = [
        { lat: undefined as unknown as number, lng: undefined as unknown as number },
        { lat: Number("nowhere"), lng: 8.5 },
      ];
      expect(frameRoute(points)).toEqual(frameRoute([]));
    });
  });

  /**
   * The frame is the page's layout: the SVG renders `w-full h-auto`, so a
   * bounding box three times taller than wide becomes a column of map that
   * pushes the rest of the page off the screen. The Alps run 68 km north to
   * south and 23 km east to west and are exactly that case.
   */
  test("a north-south route is not drawn as a tower", () => {
    const frame = frameRoute(alps);
    expect(frame.w / frame.h).toBeCloseTo(1.6, 1);
  });
});

describe("the latitude correction", () => {
  test("compresses longitude at Swiss latitudes and not at the equator", () => {
    expect(frameRoute(alps).lngScale).toBeCloseTo(Math.cos((46.42 * Math.PI) / 180), 2);
    expect(frameRoute([{ lat: 0, lng: 10 }, { lat: 0, lng: 12 }]).lngScale).toBeCloseTo(1, 2);
  });

  /**
   * The property the rest of the map leans on: inside a corrected frame a unit
   * is the same distance on the ground whichever way you measure it. That is
   * what lets the cluster radius and the basemap threshold be plain kilometres
   * rather than projection-aware distances.
   */
  test("makes one unit mean the same distance along both axes", () => {
    const centre = { lat: 46.5, lng: 8.4 };
    // Two points about 20 km from the centre, one north, one east.
    const north = { lat: centre.lat + 20 / 111.32, lng: centre.lng };
    const east = { lat: centre.lat, lng: centre.lng + 20 / (111.32 * Math.cos((46.5 * Math.PI) / 180)) };

    const frame = frameRoute([centre, north, east]);
    const [cx, cy] = place(frame, centre);
    const [nx, ny] = place(frame, north);
    const [ex, ey] = place(frame, east);

    const northUnits = Math.hypot(nx - cx, ny - cy);
    const eastUnits = Math.hypot(ex - cx, ey - cy);

    // Both are 20 km on the ground, so both must be the same length here.
    expect(eastUnits).toBeCloseTo(northUnits, 2);
    expect(kmForUnits(northUnits)).toBeCloseTo(20, 0);
    expect(kmForUnits(eastUnits)).toBeCloseTo(20, 0);
  });

  test("without it, the same two distances differ by a third", () => {
    // What the map did before: x unscaled. Kept as a test so the correction
    // cannot be quietly dropped and still look like it passes.
    const uncorrected = { ...frameRoute(alps), lngScale: 1 };
    const centre = { lat: 46.5, lng: 8.4 };
    const east = { lat: 46.5, lng: 8.4 + 20 / (111.32 * Math.cos((46.5 * Math.PI) / 180)) };
    const [cx] = place(uncorrected, centre);
    const [ex] = place(uncorrected, east);
    expect(kmForUnits(Math.abs(ex - cx))).toBeGreaterThan(28);
  });
});

describe("kilometres and units", () => {
  test("one unit is about forty kilometres", () => {
    expect(KM_PER_UNIT).toBeCloseTo(40.08, 1);
  });

  test("round-trip", () => {
    expect(kmForUnits(unitsForKm(137))).toBeCloseTo(137, 6);
  });

  test("kmBetween agrees with the known Alps spread", () => {
    // Domodossola to Susten Pass, the trip's longest leg.
    expect(kmBetween(alps[0], alps[2])).toBeGreaterThan(60);
    expect(kmBetween(alps[0], alps[2])).toBeLessThan(80);
  });

  test("kmBetween is zero for a point against itself", () => {
    expect(kmBetween(alps[0], alps[0])).toBe(0);
  });
});
