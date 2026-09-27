import type { TransportMode, TripAccent } from "@/lib/types";
import { mapAccent, mapStyle } from "@/lib/map/style";
import { MAP_VIEWBOX } from "@/lib/mapProjection";
import type { Px } from "./StopMarker";

/**
 * Q1 (docs/plans/map-redesign.md §7): every hop is a straight line between
 * its two stops, "because a curve reads as a road nobody recorded" — except
 * a flight, the one leg that never touched the ground in between, which
 * keeps a gentle arc. A small pure function so the rule is tested on its
 * own, not only by reading a rendered path.
 */
export function isArcLeg(mode: TransportMode | undefined): boolean {
  return mode === "flight";
}

/** How far a flight's arc bows out, in screen pixels, capped so a very long
 * hop does not swing off the map — the same shape of cap `WorldMap` used to
 * apply to its own mode-bowed legs, at a gentler fraction because this line
 * no longer needs to read as "which vehicle". */
function bow(x1: number, y1: number, x2: number, y2: number, px: Px): number {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  return Math.min(px(90), len * 0.16);
}

/**
 * The one place a flight's arc decides which side it bows to — B2422 folding
 * in what used to be two separate rules. `WorldMap` had its own bias toward
 * the nearer pole (a Zurich–Bangkok flight bows north, the direction the
 * real great circle actually runs, rather than sweeping south over Africa —
 * B46's own note); this primitive's first cut bowed to one fixed side
 * instead, which would have been wrong on exactly that flight once WorldMap
 * restyled onto it. Phase 1 keeps the pole bias and moves it here, so every
 * map that draws a flight through this component agrees, rather than each
 * reimplementing "toward the nearer pole" on its own.
 */
function poleBiasSide(x1: number, y1: number, x2: number, y2: number): 1 | -1 {
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // y grows southward, so "toward the pole" is negative in the north.
  const northern = my < MAP_VIEWBOX.height / 2;
  const toward = northern ? -1 : 1;
  return Math.sign(dx / len) === toward || dx === 0 ? 1 : -1;
}

function hopPath(x1: number, y1: number, x2: number, y2: number, arc: boolean, px: Px): string {
  if (!arc) return `M${x1},${y1} L${x2},${y2}`;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const b = bow(x1, y1, x2, y2, px);
  const side = poleBiasSide(x1, y1, x2, y2);
  const cx = mx - (dy / len) * b * side;
  const cy = my + (dx / len) * b * side;
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
}

export interface RouteHop {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Absent means "straight", the same as any non-flight mode. */
  mode?: TransportMode;
}

/**
 * The trip's own route: the trip's accent colour (`mapAccent`), 4 screen
 * pixels wide, with a white casing underneath so it reads over any ground.
 * Decorative — a route is not a control, so it carries no aria and eats no
 * pointer events.
 */
export default function RouteLine({
  hops,
  accent,
  px,
}: {
  hops: readonly RouteHop[];
  accent: TripAccent;
  px: Px;
}) {
  return (
    <g aria-hidden="true" pointerEvents="none" fill="none" strokeLinecap="round">
      {hops.map((hop, i) => {
        const d = hopPath(hop.x1, hop.y1, hop.x2, hop.y2, isArcLeg(hop.mode), px);
        return (
          <path
            key={i}
            d={d}
            stroke={mapStyle.routeCasing}
            strokeWidth={px(4) + px(3)}
          />
        );
      })}
      {hops.map((hop, i) => {
        const d = hopPath(hop.x1, hop.y1, hop.x2, hop.y2, isArcLeg(hop.mode), px);
        return <path key={i} d={d} stroke={mapAccent(accent)} strokeWidth={px(4)} />;
      })}
    </g>
  );
}
