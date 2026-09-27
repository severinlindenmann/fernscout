import { mapStyle } from "@/lib/map/style";
import type { Px } from "./StopMarker";

/**
 * A yellow dot with a halo — "yellow means this and nothing else, on every
 * map" (docs/plans/map-redesign.md §1). This component holds no logic about
 * whether the trip is live: **render it only when the caller has already
 * decided the trip is live** (the same check `map-tense` tests today), never
 * as a permanent marker for a documented stop. A selected stop is drawn
 * larger and navy by `StopMarker` — this is the one shape yellow is allowed
 * to be.
 *
 * Purely a drawing, not a control, so it takes no `onSelect`: an optional
 * `label` names it for anyone not seeing the dot, and without one it stays
 * decorative (`aria-hidden`).
 */
export default function HereNow({
  x,
  y,
  px,
  label,
}: {
  x: number;
  y: number;
  px: Px;
  label?: string;
}) {
  return (
    <g role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx={x} cy={y} r={px(14)} fill={mapStyle.hereNowHalo} />
      <circle cx={x} cy={y} r={px(6)} fill={mapStyle.hereNow} stroke={mapStyle.stopRing} strokeWidth={px(1.5)} />
    </g>
  );
}
