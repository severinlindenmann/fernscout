import { describe, expect, test } from "vitest";
import { vehicleHeadingTransform } from "@/components/SlideShow";

/**
 * B640 — a vehicle glyph rotated straight to a westward heading turns over,
 * so a car and a plane arrived roof-down. `vehicleHeadingTransform` mirrors
 * past vertical instead of rotating past it; these checks are on the "up"
 * vector of the icon's own local frame (0, -1) rather than eyeballing the
 * transform string, since a rotation and a mirror+rotation can look
 * identical for the forward vector and differ only in whether the icon is
 * flipped.
 */

function apply(transform: string, [x, y]: [number, number]): [number, number] {
  // Parses exactly the two shapes vehicleHeadingTransform can return:
  // "rotate(a)" or "rotate(a) scale(sx, sy)". Applied in SVG order — the
  // last-listed transform runs first on the point.
  const rotateMatch = transform.match(/rotate\(([-\d.]+)\)/);
  const scaleMatch = transform.match(/scale\(([-\d.]+),\s*([-\d.]+)\)/);
  let px = x;
  let py = y;
  if (scaleMatch) {
    px *= Number(scaleMatch[1]);
    py *= Number(scaleMatch[2]);
  }
  const deg = Number(rotateMatch![1]);
  const rad = (deg * Math.PI) / 180;
  const rx = px * Math.cos(rad) - py * Math.sin(rad);
  const ry = px * Math.sin(rad) + py * Math.cos(rad);
  return [rx, ry];
}

describe("vehicleHeadingTransform", () => {
  test("eastward heading (0deg) is a plain rotation", () => {
    expect(vehicleHeadingTransform(0)).toBe("rotate(0)");
  });

  test("westward heading (180deg) is upright, not upside down", () => {
    const [fx, fy] = apply(vehicleHeadingTransform(180), [1, 0]);
    expect(fx).toBeCloseTo(-1, 5); // forward now points west
    expect(fy).toBeCloseTo(0, 5);
    const [, uy] = apply(vehicleHeadingTransform(180), [0, -1]);
    expect(uy).toBeLessThan(0); // "up" of the icon still points up on screen
  });

  test("forward direction always matches the requested heading", () => {
    for (let deg = -180; deg <= 180; deg += 5) {
      const [fx, fy] = apply(vehicleHeadingTransform(deg), [1, 0]);
      const rad = (deg * Math.PI) / 180;
      expect(fx).toBeCloseTo(Math.cos(rad), 5);
      expect(fy).toBeCloseTo(Math.sin(rad), 5);
    }
  });

  test("the glyph is never inverted, for any heading", () => {
    for (let deg = -180; deg <= 180; deg += 5) {
      const [, uy] = apply(vehicleHeadingTransform(deg), [0, -1]);
      // Never flips past horizontal into pointing screen-downward.
      expect(uy).toBeLessThanOrEqual(0);
    }
  });
});
