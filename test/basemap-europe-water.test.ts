import { describe, expect, test } from "vitest";
import { basemapFor } from "@/lib/basemap";
import { frameRoute } from "@/lib/mapFrame";

/**
 * B2425 — Natural Earth's *worldwide* 1:10m lake and river layers leave real
 * gaps at Alpine scale (checked while making the map-redesign mockups: none
 * of the lakes or rivers this test looks for exist in that file at any
 * resolution). `scripts/build-mapdata.mjs` now merges Natural Earth's
 * regional "Europe" supplements (`ne_10m_lakes_europe`, `ne_10m_rivers_europe`)
 * into the one baked `lakes`/`rivers` layer, deduping anything the worldwide
 * file already carries.
 *
 * This clips the baked bundle to the same four-stop Alpine frame the rest of
 * the basemap tests use and asserts the added water actually shows up near
 * real coordinates, rather than merely asserting the layer grew. No content
 * folder, no person's own trip or place is read here — the coordinates are
 * public geography, the same ones already written into the build script's
 * own comments.
 */

/** Four stops inside 68 km, entirely inland — the same frame test/basemap.test.ts frames. */
const ALPS = [
  { lat: 46.1161, lng: 8.2939 },
  { lat: 46.5614, lng: 8.3372 },
  { lat: 46.7297, lng: 8.4444 },
  { lat: 46.6364, lng: 8.5942 },
];

/**
 * `lib/mapProjection.mjs`'s own `project`, duplicated rather than imported:
 * that file is loaded as plain ESM by the build script and has no `.ts`
 * counterpart to import from a Vitest module.
 */
function project(lat: number, lng: number): [number, number] {
  return [((lng + 180) / 360) * 1000, ((90 - lat) / 180) * 500];
}

/**
 * Whether any point drawn in one of these paths lands within `tolerance`
 * projected units of a lat/lng — paths come back in the bundle's own
 * uncorrected space (see `basemapFor`'s doc comment), the same space
 * `project` computes here. 0.3 units is a little over 100 km at this
 * latitude: generous enough to survive the bake's 40 m quantisation and a
 * lake or river's own size, tight enough that it cannot be satisfied by
 * Switzerland's border alone.
 */
function hasPointNear(paths: readonly string[], lat: number, lng: number, tolerance = 0.3): boolean {
  const [tx, ty] = project(lat, lng);
  for (const d of paths) {
    for (const match of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (Math.abs(x - tx) < tolerance && Math.abs(y - ty) < tolerance) return true;
    }
  }
  return false;
}

describe("B2425 — the Alpine frame has the water Natural Earth's worldwide layer omits", () => {
  const map = basemapFor(frameRoute(ALPS))!;

  test("the bundle loaded", () => {
    expect(map).not.toBeNull();
  });

  test("has lake polygons near all three known coordinates", () => {
    expect(hasPointNear(map.lakes, 46.68, 7.72)).toBe(true);
    expect(hasPointNear(map.lakes, 46.71, 7.95)).toBe(true);
    expect(hasPointNear(map.lakes, 47.0, 8.4)).toBe(true);
  });

  test("has river lines near both known coordinates", () => {
    expect(hasPointNear(map.rivers, 46.68, 7.9)).toBe(true);
    expect(hasPointNear(map.rivers, 47.05, 8.33)).toBe(true);
  });
});
