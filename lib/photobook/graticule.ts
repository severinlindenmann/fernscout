/**
 * How far apart the map's meridians and parallels go.
 *
 * Its own file because both the PDF renderer and the HTML preview draw the
 * graticule, and a spacing rule that lived in one of them would be a spacing
 * rule the other slowly disagreed with — which is the fault the preview
 * exists to catch rather than to have.
 */

import { MAP_SPACE } from "./plan.ts";

/**
 * Degrees between lines, in MAP_SPACE units, for a window this wide.
 *
 * `MAP_SPACE.width` is 1000 units to 360 degrees, so one degree is about 2.78
 * units. Picks the first interval leaving no more than about eight lines: a
 * fixed spacing would draw one line across Utah and four hundred across the
 * Pacific.
 */
export function graticuleStep(windowWidth: number): number {
  const perDegree = MAP_SPACE.width / 360;
  for (const degrees of [1, 2, 5, 10, 20, 30, 45, 60]) {
    if (windowWidth / (degrees * perDegree) <= 8) return degrees * perDegree;
  }
  return 60 * perDegree;
}
