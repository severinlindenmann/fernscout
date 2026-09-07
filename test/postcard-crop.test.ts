import { describe, expect, test } from "vitest";
import { CENTRE, view, zoomInto } from "@/lib/postcard/crop";
import { MAX_CROP_ZOOM } from "@/lib/postcard/spec";

/**
 * B627 — the arithmetic behind the dragged rectangle.
 *
 * `test/postcard.test.ts` checks what a `Crop` prints; this checks the one
 * step before it, that the rectangle somebody drew over the frame becomes the
 * crop that shows exactly that rectangle. Getting it wrong is not a crash: it
 * is a card cropped somewhere near where it was asked for, which nobody would
 * catch from a screenshot.
 */
const at = (anchor: number, zoom: number, f: number) => {
  const { a, b } = view(anchor, zoom);
  return a * f + b;
};

describe("dragging a rectangle", () => {
  test("the new frame shows exactly the rectangle that was dragged", () => {
    for (const [anchor, zoom, from, size] of [
      [0.5, 1, 0.25, 0.5],
      [0.5, 1, 0, 0.5],
      [0.2, 2, 0.5, 0.5],
      [0.8, 1.5, 0.1, 0.8],
    ]) {
      const next = zoomInto(anchor, zoom, from, size);
      // The rectangle's own edges, in cover-crop fractions, before and after.
      expect(at(next.anchor, next.zoom, 0)).toBeCloseTo(at(anchor, zoom, from), 6);
      expect(at(next.anchor, next.zoom, 1)).toBeCloseTo(at(anchor, zoom, from + size), 6);
    }
  });

  test("zooms compound, and stop at the ceiling", () => {
    const once = zoomInto(0.5, 1, 0.25, 0.5);
    expect(once.zoom).toBeCloseTo(2, 6);
    expect(zoomInto(once.anchor, once.zoom, 0.25, 0.5).zoom).toBeCloseTo(4, 6);
    // Half of half of half is 8×, which is past what an A6 card can print.
    expect(zoomInto(0.5, 4, 0.25, 0.5).zoom).toBe(MAX_CROP_ZOOM);
  });

  test("dragging the whole frame changes nothing, and reads as the centre", () => {
    expect(zoomInto(0.3, 1, 0, 1)).toEqual({ anchor: 0.5, zoom: 1 });
    expect(CENTRE).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
  });

  test("the anchor stays a fraction of the photograph, whatever was dragged", () => {
    for (const from of [0, 0.5, 0.9]) {
      const next = zoomInto(0.5, 1, from, 0.1);
      expect(next.anchor).toBeGreaterThanOrEqual(0);
      expect(next.anchor).toBeLessThanOrEqual(1);
    }
  });
});
