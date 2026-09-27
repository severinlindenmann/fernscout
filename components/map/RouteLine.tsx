import type { TransportMode, TripAccent } from "@/lib/types";
import { mapAccent, mapStyle } from "@/lib/map/style";
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
 * hop does not swing off the map — the same shape of cap `WorldMap` already
 * applies to its own mode-bowed legs, at a gentler fraction because this
 * line no longer needs to read as "which vehicle". */
function bow(x1: number, y1: number, x2: number, y2: number, px: Px): number {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  return Math.min(px(90), len * 0.16);
}

function hopPath(x1: number, y1: number, x2: number, y2: number, arc: boolean, px: Px): string {
  if (!arc) return `M${x1},${y1} L${x2},${y2}`;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const b = bow(x1, y1, x2, y2, px);
  // ponytail: bows to one fixed side rather than toward the nearer pole the
  // way WorldMap's own great-circle bias does — a real regression there
  // would look wrong on a specific long-haul flight, not here, where Phase 1
  // restyles WorldMap itself onto whatever this primitive draws.
  const cx = mx - (dy / len) * b;
  const cy = my + (dx / len) * b;
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
