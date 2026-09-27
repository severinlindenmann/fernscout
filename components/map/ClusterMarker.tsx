import { mapStyle } from "@/lib/map/style";
import type { Px } from "./StopMarker";

/**
 * Several stops that landed on top of each other at this zoom: a navy disc
 * with the count. Tapping it is "zoom in", not "pick one arbitrarily" — the
 * caller supplies `onSelect` for that, the same way `TripMap`'s own
 * `closer()` does today.
 */
export default function ClusterMarker({
  x,
  y,
  count,
  ariaLabel,
  px,
  onSelect,
}: {
  x: number;
  y: number;
  count: number;
  ariaLabel: string;
  px: Px;
  onSelect?: () => void;
}) {
  const radius = px(11);
  return (
    <g
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={ariaLabel}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onSelect();
            }
          : undefined
      }
    >
      <circle cx={x} cy={y} r={radius} fill={mapStyle.clusterFill} stroke={mapStyle.stopRing} strokeWidth={px(2.5)} />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={px(11)}
        fontWeight={700}
        fill={mapStyle.clusterText}
        pointerEvents="none"
      >
        {count}
      </text>
      {onSelect && <circle cx={x} cy={y} r={px(22)} fill="transparent" />}
    </g>
  );
}
