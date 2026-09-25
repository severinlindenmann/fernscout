import { describe, expect, it } from "vitest";
import { parsePath, type Segment } from "@/lib/travellers/path";
import { figureShapes } from "@/lib/travellers/shapes";
import { HAIR_STYLES, OUTFITS, ACCESSORIES } from "@/lib/travellers/vocabulary";

/**
 * The converter the printed book depends on.
 *
 * PDF has no arc and no quadratic, so every traveller path has to be reduced
 * to cubics before it can be printed. Getting that subtly wrong bends somebody
 * into a shape nobody notices until it comes back from a printer, which is why
 * this is tested against geometry with known answers rather than by eye.
 */

const near = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) < tolerance;

/** Walk the segments and collect the points actually reached. */
function endpoints(segments: Segment[]): Array<[number, number]> {
  return segments
    .filter((s) => s.op !== "Z")
    .map((s) => [(s as { x: number }).x, (s as { y: number }).y] as [number, number]);
}

describe("parsing path data", () => {
  it("reads a repeated coordinate pair after M as a lineto", () => {
    // "M20.4 23.4 16.8 22.2" is a move and then a line, not two moves.
    const segments = parsePath("M20.4 23.4 16.8 22.2");
    expect(segments.map((s) => s.op)).toEqual(["M", "L"]);
    expect(segments[1]).toMatchObject({ x: 16.8, y: 22.2 });
  });

  it("handles relative commands", () => {
    const segments = parsePath("M10 10l5 0l0 5");
    expect(endpoints(segments)).toEqual([
      [10, 10],
      [15, 10],
      [15, 15],
    ]);
  });

  it("handles h and v", () => {
    expect(endpoints(parsePath("M0 0h10v5"))).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
    ]);
  });

  /**
   * A quadratic is a cubic whose controls sit two-thirds of the way to the
   * shared control point. Exact, so the numbers are checkable.
   */
  it("converts a quadratic to the exactly equivalent cubic", () => {
    const [, curve] = parsePath("M0 0q6 0 6 6");
    expect(curve.op).toBe("C");
    if (curve.op !== "C") throw new Error("unreachable");
    expect(near(curve.x1, 4)).toBe(true);
    expect(near(curve.y1, 0)).toBe(true);
    expect(near(curve.x2, 6)).toBe(true);
    expect(near(curve.y2, 2)).toBe(true);
    expect(near(curve.x, 6)).toBe(true);
    expect(near(curve.y, 6)).toBe(true);
  });

  /**
   * The flags of an arc may be packed against the number after them:
   * `a4.6 4.6 0 109.2 0` is large-arc=1, sweep=0, x=9.2 — not a number 109.2.
   * A tokeniser that misses this reads a wildly wrong endpoint and the shape
   * silently deforms.
   */
  it("reads arc flags packed against the following number", () => {
    const packed = parsePath("M0 0a5 5 0 1110 0");
    const spaced = parsePath("M0 0a5 5 0 1 1 10 0");
    expect(packed).toEqual(spaced);
    // And it really did land at x=10, rather than at some hundreds.
    const last = packed[packed.length - 1];
    if (last.op !== "C") throw new Error("unreachable");
    expect(near(last.x, 10, 1e-9)).toBe(true);
  });

  describe("arcs", () => {
    /**
     * A quarter circle of radius r from (r,0) to (0,r) has control points at
     * a known distance: k = 4/3·tan(π/8) ≈ 0.5523 of the radius.
     */
    it("converts a quarter circle to one cubic with the known control points", () => {
      const segments = parsePath("M10 0A10 10 0 0 1 0 10");
      expect(segments.filter((s) => s.op === "C")).toHaveLength(1);
      const curve = segments[1];
      if (curve.op !== "C") throw new Error("unreachable");
      const k = (4 / 3) * Math.tan(Math.PI / 8) * 10;
      expect(near(curve.x1, 10, 1e-6)).toBe(true);
      expect(near(curve.y1, k, 1e-6)).toBe(true);
      expect(near(curve.x2, k, 1e-6)).toBe(true);
      expect(near(curve.y2, 10, 1e-6)).toBe(true);
      expect(near(curve.x, 0, 1e-9)).toBe(true);
      expect(near(curve.y, 10, 1e-9)).toBe(true);
    });

    it("splits a half circle into two cubics and lands on the far side", () => {
      const segments = parsePath("M0 0a15 15 0 0130 0");
      const curves = segments.filter((s) => s.op === "C");
      expect(curves).toHaveLength(2);
      const last = curves[curves.length - 1];
      if (last.op !== "C") throw new Error("unreachable");
      expect(near(last.x, 30, 1e-9)).toBe(true);
      expect(near(last.y, 0, 1e-9)).toBe(true);
    });

    it("puts the sweep on the correct side", () => {
      // Same endpoints, opposite sweep flags: the midpoints must straddle the
      // chord. This is the flag that, reversed, turns hair into a chin.
      const up = parsePath("M0 0a15 15 0 0130 0").filter((s) => s.op === "C");
      const down = parsePath("M0 0a15 15 0 0030 0").filter((s) => s.op === "C");
      const upMid = up[0];
      const downMid = down[0];
      if (upMid.op !== "C" || downMid.op !== "C") throw new Error("unreachable");
      expect(Math.sign(upMid.y)).toBe(-Math.sign(downMid.y));
    });

    it("scales radii that are too small to span the chord", () => {
      // r=1 cannot reach 20 away; the spec says grow it rather than give up.
      const segments = parsePath("M0 0a1 1 0 0120 0");
      expect(segments.length).toBeGreaterThan(1);
      const last = segments[segments.length - 1];
      if (last.op !== "C") throw new Error("unreachable");
      expect(near(last.x, 20, 1e-9)).toBe(true);
      expect(Number.isFinite(last.y)).toBe(true);
    });

    it("never emits NaN, for any path the figure actually uses", () => {
      const styles = HAIR_STYLES.map((hairStyle) => ({ hairStyle }));
      const outfits = OUTFITS.map((outfit) => ({ outfit }));
      const extras = ACCESSORIES.map((a) => ({ accessories: [a] }));
      for (const figure of [...styles, ...outfits, ...extras]) {
        const collect = (shapes: ReturnType<typeof figureShapes>): void => {
          for (const shape of shapes) {
            if (shape.kind === "group") collect(shape.shapes);
            if (shape.kind !== "path") continue;
            for (const segment of parsePath(shape.d)) {
              for (const [key, value] of Object.entries(segment)) {
                if (key === "op") continue;
                expect(Number.isFinite(value), `${JSON.stringify(figure)} ${shape.d} ${key}`).toBe(
                  true,
                );
              }
            }
          }
        };
        collect(figureShapes(figure));
      }
    });
  });
});
