"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import {
  BuildingShape,
  hashString,
  mulberry32,
  ROOFS,
  WALLS,
  type Building,
} from "@/components/Cityscape";

/**
 * A dense, full-width skyline — the backdrop above a `metro` leg's
 * `TunnelWall` (B1545). The two named `Cityscape`s in `TravelScene.tsx` draw
 * the departure and arrival place and stay put at the frame's edges; this is
 * what stands over the tunnel in between, so a metro leg reads as a crossing
 * under an actual city rather than under two towns with an empty gap.
 *
 * Not tied to `population` or a real place name the way `Cityscape` is —
 * there is no third location to draw it from — so it is generated from the
 * leg's own destination name purely for a stable seed, at a size the two
 * named skylines never reach on their own: enough towers to fill the width
 * moving the camera exposes, tiled with `OVERHANG` the same way `Ground`
 * tiles its surfaces.
 */
export default function Skyline({
  seed,
  scroll,
  bottom,
}: {
  seed: string;
  scroll: MotionValue<number>;
  /** Where the ground actually is, in px — buildings stand on it like
   * everything else in the scene. */
  bottom: number;
}) {
  const x = useTransform(scroll, [0, 1], [0, TILE_SHIFT]);
  const rand = mulberry32(hashString(seed));
  const baseY = HEIGHT;
  const buildings: Building[] = [];
  let cx = 6;
  while (cx < PERIOD - 16) {
    const w = 22 + Math.floor(rand() * 26);
    const h = 34 + Math.floor(rand() * (HEIGHT - 46));
    const ci = Math.floor(rand() * WALLS.length);
    const kindRoll = rand();
    const kind: Building["kind"] =
      kindRoll > 0.88 ? "spire" : kindRoll > 0.74 ? "dome" : kindRoll > 0.4 ? "pitched" : "flat";
    buildings.push({ x: cx, w, h, wall: WALLS[ci], roof: ROOFS[ci], kind, seed: rand() * 1e9 });
    cx += w + 5 + Math.floor(rand() * 8);
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 overflow-hidden" style={{ bottom, height: HEIGHT }}>
      <motion.div
        className="absolute inset-y-0"
        style={{ x, left: -OVERHANG, width: `calc(100% + ${2 * OVERHANG}px)` }}
      >
        <svg width="100%" height="100%" preserveAspectRatio="none" aria-hidden>
          <defs>
            <pattern id="fs-skyline" width={PERIOD} height={HEIGHT} patternUnits="userSpaceOnUse">
              {buildings.map((b, i) => (
                <BuildingShape key={i} b={b} baseY={baseY} />
              ))}
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#fs-skyline)" />
        </svg>
      </motion.div>
    </div>
  );
}

/** How tall the strip is — tall enough for a proper skyscraper row, short
 * enough that it still reads as sitting behind the two named cities rather
 * than replacing them. */
const HEIGHT = 150;

/** One tiled period's width, in px — wide enough that the repeat is not
 * obvious at the widths this scene actually renders. */
const PERIOD = 640;

/** Same reasoning as `Ground`'s `TILE_SHIFT`: a background skyline reads as
 * more distant than the tunnel wall in front of it, so it moves less over
 * the same leg. */
const TILE_SHIFT = -90;

/** Matches `Ground`'s own `OVERHANG`. */
const OVERHANG = 320;
