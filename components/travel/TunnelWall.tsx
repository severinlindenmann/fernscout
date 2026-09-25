"use client";

import { motion, useTransform, type MotionValue } from "motion/react";

/**
 * The lower half of the frame, for a leg that actually runs underground —
 * `metro`, and only `metro`; `tram` stays street-level and keeps the plain
 * rail band `Ground` already draws. B1545.
 *
 * Sits directly above `Ground`'s own rail band (`bottom: groundH`) rather
 * than replacing it, and stops partway up the frame rather than filling it —
 * the skyline stays visible above, which is the whole point: a metro leg
 * still arrives somewhere, it just spends the crossing itself below ground.
 *
 * Same parallax contract as `Ground` — a `scroll` MotionValue driving a tiled
 * pattern — so a metro leg's wall keeps pace with its own rail rather than
 * drifting against it.
 */
export default function TunnelWall({
  scroll,
  bottom,
}: {
  /** 0 → 1 across the leg. */
  scroll: MotionValue<number>;
  /** Where `Ground`'s own band starts, in px — the wall sits just above it. */
  bottom: number;
}) {
  const x = useTransform(scroll, [0, 1], [0, TILE_SHIFT]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 overflow-hidden"
      style={{ bottom, height: HEIGHT }}
    >
      <div className="absolute inset-0" style={{ background: "#20242e" }} />
      <motion.div
        className="absolute inset-y-0"
        style={{ x, left: -OVERHANG, width: `calc(100% + ${2 * OVERHANG}px)` }}
      >
        <svg width="100%" height="100%" preserveAspectRatio="none" aria-hidden>
          <defs>
            <pattern id="fs-tunnel-bricks" width={46} height={24} patternUnits="userSpaceOnUse">
              <rect width={46} height={24} fill="#20242e" />
              <rect x={1} y={1} width={20} height={10} rx={2} fill="#262b36" />
              <rect x={24} y={1} width={20} height={10} rx={2} fill="#262b36" />
              <rect x={13} y={13} width={20} height={10} rx={2} fill="#262b36" />
            </pattern>
            <pattern id="fs-tunnel-lamps" width={LAMP_SPACING} height="100%" patternUnits="userSpaceOnUse">
              <circle cx={LAMP_SPACING / 2} cy="34%" r={5} fill="#f0c05a" opacity={0.9} />
              <circle cx={LAMP_SPACING / 2} cy="34%" r={12} fill="#f0c05a" opacity={0.18} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#fs-tunnel-bricks)" />
          <rect width="100%" height="100%" fill="url(#fs-tunnel-lamps)" />
        </svg>
      </motion.div>
      {/* The join with the sky/skyline layer above — a hard edge would read
          as a seam, so this is a thin gradient rather than a flat line. */}
      <div
        className="absolute inset-x-0 top-0 h-3"
        style={{ background: "linear-gradient(180deg, rgba(32,36,46,0) 0%, #20242e 100%)" }}
      />
    </div>
  );
}

/** How tall the wall stands above `Ground`'s own rail band. Exported so
 * `TravelScene.tsx` can stand `Skyline`'s buildings on top of it — the roof
 * of the tunnel, not the ground the tunnel is dug into — rather than half
 * burying them in the wall. */
export const TUNNEL_WALL_HEIGHT = 110;
const HEIGHT = TUNNEL_WALL_HEIGHT;

/** How far the brick tiles slide over a whole leg, in px — between `road`'s
 * -260 and `rail`'s -220 in `Ground`, since the wall reads at roughly the
 * same distance as the rail it stands beside. */
const TILE_SHIFT = -220;

/** Matches `Ground`'s own `OVERHANG`, for the same reason: has to exceed
 * `TILE_SHIFT` or the tiled run ends inside the frame before the leg does. */
const OVERHANG = 320;

const LAMP_SPACING = 130;
