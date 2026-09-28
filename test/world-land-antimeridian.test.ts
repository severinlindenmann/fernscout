import { describe, expect, test } from "vitest";
import worldLand from "@/lib/worldLand.json";

/**
 * B2513. `scripts/build-world-map.mjs` used to cut a ring at the
 * antimeridian and close each fragment with a plain `Z` — the same bug
 * B2491 fixed in `scripts/build-mapdata.mjs`'s `ringToShape`, here in the
 * plain-outline bake instead. The fix (`scripts/antimeridian.mjs`, shared by
 * both scripts) unwraps the ring rather than cutting it, so it reaches this
 * file as an ordinary, non-self-crossing polygon. This asserts the outcome
 * directly against the real committed `lib/worldLand.json`, same threshold
 * as B2491's own keeper test for the basemap bundle.
 */
describe("B2513 — no antimeridian chord in lib/worldLand.json", () => {
  test("no path has an edge over 300 units", () => {
    let maxEdge = 0;
    for (const d of worldLand as string[]) {
      for (const sub of d.split(/(?=M)/)) {
        const pts = [...sub.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [
          Number(m[1]),
          Number(m[2]),
        ]);
        for (let i = 1; i < pts.length; i++) {
          maxEdge = Math.max(maxEdge, Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        }
        // The closing edge — the one a naive per-fragment `Z` got wrong.
        if (pts.length > 1) {
          const first = pts[0];
          const last = pts[pts.length - 1];
          maxEdge = Math.max(maxEdge, Math.hypot(last[0] - first[0], last[1] - first[1]));
        }
      }
    }
    expect(maxEdge).toBeLessThan(300);
  });
});
