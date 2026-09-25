import { describe, expect, test } from "vitest";
import worldCountries from "@/lib/worldCountries.json";

/**
 * B1594 — Natural Earth's admin-0 features are sovereign states, not
 * countries as a traveller means them. France's baked shape used to be one
 * MultiPolygon spanning metropolitan France and French Guiana, three
 * thousand miles apart, so a trip that only ever visited Paris coloured in
 * South America too. `scripts/build-world-countries.mts`'s `SPLITS` table
 * pulls French Guiana off under its own code (`GF`) before the fill and the
 * label are built.
 *
 * `lib/mapProjection.mjs`'s `project` is `x = ((lng + 180) / 360) * 1000` —
 * linear, so a longitude bound converts to an x bound directly.
 */

const VIEWBOX_WIDTH = 1000;
function lngToX(lng: number): number {
  return ((lng + 180) / 360) * VIEWBOX_WIDTH;
}
function xCoordsOf(path: string): number[] {
  return [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}

describe("the baked world countries", () => {
  test("France's path stays east of -10 degrees — it no longer carries French Guiana", () => {
    const fr = worldCountries.find((c) => c.code === "FR");
    expect(fr).toBeDefined();
    const xs = xCoordsOf(fr!.path);
    expect(Math.min(...xs)).toBeGreaterThan(lngToX(-10));
  });

  test("a day in French Guiana still colours something, under its own code", () => {
    const gf = worldCountries.find((c) => c.code === "GF");
    expect(gf).toBeDefined();
    expect(gf!.path.length).toBeGreaterThan(0);
    // It really is the part that used to be attached to France: west of -20°.
    const xs = xCoordsOf(gf!.path);
    expect(Math.max(...xs)).toBeLessThan(lngToX(-20));
  });
});
