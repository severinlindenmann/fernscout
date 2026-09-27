import { mapStyle } from "@/lib/map/style";
import type { Px } from "./StopMarker";

/**
 * A planned leg nobody has walked yet: navy, dashed, 60% opacity — "the
 * same on every map" (docs/plans/map-redesign.md §1). Straight only; a
 * plan has no recorded shape to arc around.
 */
export default function PlannedLine({
  points,
  px,
}: {
  points: readonly { x: number; y: number }[];
  px: Px;
}) {
  if (points.length < 2) return null;
  return (
    <polyline
      aria-hidden="true"
      pointerEvents="none"
      points={points.map((p) => `${p.x},${p.y}`).join(" ")}
      fill="none"
      stroke={mapStyle.plannedLeg}
      strokeOpacity={0.6}
      strokeWidth={px(2)}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={`${px(6)} ${px(6)}`}
    />
  );
}
