"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import type { TransportMode } from "@/lib/types";

/**
 * What the leg is crossing.
 *
 * There used to be one strip of green under every mode, so a ferry sailed
 * across a lawn and a train ran on grass. The mode is the single most
 * informative thing a leg carries — it is in the caption, it picks the
 * vehicle, it decides whether the scene arcs — and the ground is where it can
 * be said without a word.
 *
 * Each surface is one repeating tile scrolled horizontally by the leg's own
 * progress, which is also what carries the parallax: this is the nearest layer
 * and therefore the fastest, the skylines are middle, the clouds are slowest.
 * A repeating `<pattern>` rather than a row of elements, because the scene has
 * to keep drawing while the tile scrolls a whole period and a fixed row would
 * run out.
 */

export type Surface = "rail" | "road" | "water" | "sky" | "path";

/** Which surface a mode travels on. Exported for its test — the mapping is
 * the whole content of this module and it is easy to get one entry wrong. */
export function surfaceFor(mode: TransportMode): Surface {
  switch (mode) {
    case "train":
    case "metro":
    case "tram":
      return "rail";
    case "car":
    case "taxi":
    case "bus":
    case "motorbike":
    case "bicycle":
      return "road";
    case "boat":
    case "ferry":
      return "water";
    case "flight":
      return "sky";
    case "walk":
      return "path";
  }
}

/** How tall the surface's band is, so the scene knows where to stand things. */
export const GROUND_HEIGHT: Record<Surface, number> = {
  rail: 44,
  road: 46,
  water: 66,
  sky: 0,
  path: 40,
};

/**
 * How far one surface's tiles slide over a whole leg, in px.
 *
 * Deliberately unequal: sleepers a metre apart and a lane marking every ten
 * read at different speeds even when the train and the car do not.
 */
const TILE_SHIFT: Record<Surface, number> = {
  rail: -220,
  road: -260,
  water: -140,
  path: -180,
  sky: 0,
};

/**
 * How far past each edge of the frame the surface is drawn, in px.
 *
 * Has to exceed every `TILE_SHIFT` above, or the tile run ends inside the
 * frame before the leg does.
 */
const OVERHANG = 320;

export default function Ground({
  surface,
  scroll,
}: {
  surface: Surface;
  /** 0 → 1 across the leg. Drives the tile offset, and nothing else. */
  scroll: MotionValue<number>;
}) {
  // Before the early return below: `sky` draws nothing, and a hook that only
  // runs for the other four surfaces is a hook that changes count per render.
  const x = useTransform(scroll, [0, 1], [0, TILE_SHIFT[surface]]);
  if (surface === "sky") return null;

  const height = GROUND_HEIGHT[surface];

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden"
      style={{ height }}
    >
      <div className="absolute inset-0" style={{ background: BACKDROP[surface] }} />
      {/* The slack the tiles slide into, and it is in pixels because the
          slide is: `-left-[10%] w-[130%]` gave 20% of the *frame* on the
          right, which is 140px on the story's own width and 72px on a phone,
          against a road that moves 260px over the leg. So the last second of
          every crossing ran off the end of its own surface and arrived on
          bare backdrop — the rails simply stopped, short of the destination,
          and the narrower the screen the sooner. `OVERHANG` beats the largest
          `TILE_SHIFT` at every width. */}
      <motion.div
        className="absolute inset-y-0"
        style={{ x, left: -OVERHANG, width: `calc(100% + ${2 * OVERHANG}px)` }}
      >
        <svg width="100%" height={height} preserveAspectRatio="none" aria-hidden>
          <defs>
            <pattern
              id={`fs-ground-${surface}`}
              width={TILE[surface]}
              height={height}
              patternUnits="userSpaceOnUse"
            >
              <Tile surface={surface} height={height} />
            </pattern>
          </defs>
          <rect width="100%" height={height} fill={`url(#fs-ground-${surface})`} />
        </svg>
      </motion.div>
      {/* The far edge of the surface, which does not scroll — it is the join
          with the world behind and would shimmer if it did. */}
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: EDGE[surface] }} />
    </div>
  );
}

const BACKDROP: Record<Surface, string> = {
  rail: "#dff0d8",
  road: "#e4ead4",
  water: "#7fc6e0",
  sky: "transparent",
  path: "#dff0d8",
};

const EDGE: Record<Surface, string> = {
  rail: "#bcd9b4",
  road: "#c9d4b2",
  water: "#a5dcee",
  sky: "transparent",
  path: "#bcd9b4",
};

/** One period of each surface, in px. */
const TILE: Record<Surface, number> = {
  rail: 22,
  road: 60,
  water: 48,
  sky: 1,
  path: 20,
};

function Tile({ surface, height }: { surface: Surface; height: number }) {
  if (surface === "rail") {
    // Ballast, a sleeper every tile, and two rails the vehicle's wheels land
    // on. The rail heights match `Vehicle`'s wheel baseline.
    return (
      <>
        <rect y={height - 20} width={22} height={20} fill="#cfe3c6" />
        <rect x={4} y={height - 17} width={14} height={5} rx={1.5} fill="#a5825b" />
        <rect y={height - 12} width={22} height={3} fill="#8f9aa8" />
        <rect y={height - 6} width={22} height={2.5} fill="#7c8794" />
      </>
    );
  }
  if (surface === "road") {
    return (
      <>
        <rect y={height - 24} width={60} height={24} fill="#5a6a80" />
        <rect y={height - 24} width={60} height={2} fill="#78859a" />
        <rect x={10} y={height - 13} width={26} height={3} rx={1.5} fill="#fffaf0" opacity={0.85} />
      </>
    );
  }
  if (surface === "water") {
    // Two rows of crests, offset, so the sea does not read as a comb.
    return (
      <>
        <rect width={48} height={height} fill="#7fc6e0" />
        <path
          d={`M0,${height - 34} q12,-6 24,0 t24,0`}
          stroke="#a5dcee"
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M-12,${height - 18} q12,-6 24,0 t24,0 t24,0`}
          stroke="#9ad4ea"
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M6,${height - 6} q10,-5 20,0`}
          stroke="#b7e6f4"
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
        />
      </>
    );
  }
  // path — trodden earth, stones in it, for a leg on foot
  return (
    <>
      <rect y={height - 16} width={20} height={16} fill="#d9c9a3" />
      <rect y={height - 16} width={20} height={2} fill="#c4b088" />
      <circle cx={6} cy={height - 8} r={1.6} fill="#b9a279" />
      <circle cx={15} cy={height - 5} r={1.2} fill="#b9a279" />
    </>
  );
}
