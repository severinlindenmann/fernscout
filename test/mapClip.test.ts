import { describe, expect, test } from "vitest";
import { clipPath, parsePath, type ClipBox } from "@/lib/mapClip";

/**
 * B177 — cutting a baked path down to the box a map actually shows.
 *
 * The cases that matter are the ones where "drop the points outside" would be
 * wrong: a country that swallows the frame whole (its fill *is* the land), and
 * a river that leaves and comes back (one stroke would draw a chord across the
 * gap).
 */

const BOX: ClipBox = { x0: 0, y0: 0, x1: 10, y1: 10 };

/** Every coordinate pair in a path, in order. */
function points(d: string): [number, number][] {
  return [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe("clipping a filled shape", () => {
  test("a polygon that swallows the box comes back as the box", () => {
    // Switzerland around a frame over one valley: not one of its vertices is
    // inside, and the answer is still "all of this is land".
    const cut = clipPath("M-100,-100 L100,-100 L100,100 L-100,100 Z", BOX, true);
    const xs = points(cut).map((p) => p[0]);
    const ys = points(cut).map((p) => p[1]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(10);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(10);
    expect(cut.trimEnd().endsWith("Z")).toBe(true);
  });

  test("a polygon crossing one edge is closed along it", () => {
    const cut = clipPath("M5,5 L20,5 L20,8 L5,8 Z", BOX, true);
    for (const [x, y] of points(cut)) {
      expect(x).toBeLessThanOrEqual(10);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(10);
    }
    // Still one closed ring, so it still fills.
    expect(cut.match(/M/g)).toHaveLength(1);
    expect(cut.trimEnd().endsWith("Z")).toBe(true);
  });

  test("a polygon nowhere near the box is dropped", () => {
    expect(clipPath("M100,100 L110,100 L110,110 Z", BOX, true)).toBe("");
  });

  test("a shape already inside keeps its geometry", () => {
    expect(points(clipPath("M1,1 L2,2 L3,1 Z", BOX, true))).toEqual([
      [1, 1],
      [2, 2],
      [3, 1],
    ]);
  });
});

describe("clipping a stroked line", () => {
  test("a line that leaves and returns becomes two strokes, not one chord", () => {
    const cut = clipPath("M-5,5 L15,5 L15,8 L-5,8", BOX, false);
    expect(cut.match(/M/g)).toHaveLength(2);
    expect(cut).not.toContain("Z");
    for (const [x] of points(cut)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10);
    }
  });

  test("a line is never closed, however it was cut", () => {
    expect(clipPath("M-5,5 L15,5", BOX, false)).toBe("M0,5 L10,5");
  });

  test("each subpath of an antimeridian split is cut on its own", () => {
    // scripts/build-mapdata.mjs lifts the pen at ±180°, so one `d` can hold
    // several runs. One of these is in the box, one is not.
    const cut = clipPath("M1,1 L2,2 M900,1 L901,2", BOX, false);
    expect(cut).toBe("M1,1 L2,2");
  });
});

describe("what the clipper refuses to guess at", () => {
  test("a path it cannot parse travels whole, rather than vanishing", () => {
    // A basemap missing a country is a worse failure than one carrying too
    // much of it, so an unexpected command is passed through untouched.
    const curve = "M1,1 C2,2 3,3 4,4";
    expect(clipPath(curve, BOX, false)).toBe(curve);
    expect(parsePath(curve)).toBeNull();
  });

  test("trailing zeros are dropped, because 12.30 and 12.3 are the same place", () => {
    // "2.50" survives the cut as "2.5", and "10.00" as "10".
    expect(clipPath("M-5,2.50 L15,2.50", BOX, false)).toBe("M0,2.5 L10,2.5");
  });
});
