import { mapStyle } from "@/lib/map/style";

/** Screen pixels for one map-unit, the same convention every SVG map already
 * scales its markers with (see the comment beside `px` in `TripMap`). */
export type Px = (pixels: number) => number;

/**
 * One stop: a white disc, a navy ring, and the day-order number inside it —
 * the one marker shape every map (`TripMap`, `WorldMap`, `LifetimeMap`,
 * `SlideMap`) restyles onto in Phase 1 of docs/plans/map-redesign.md.
 *
 * Selected is a **larger navy disc with a white number**, never the yellow
 * `HereNow` uses — yellow means "a trip is live" everywhere on this map, and
 * a selection is not that.
 *
 * The caller composes the accessible name (`${location}, ${country}`, the
 * way `TripMap` already does with its own translated strings) rather than
 * this primitive holding an i18n dependency of its own.
 */
export default function StopMarker({
  x,
  y,
  order,
  selected = false,
  ariaLabel,
  px,
  onSelect,
}: {
  x: number;
  y: number;
  /** The stop's 1-based position in day order — survives every zoom. */
  order: number;
  selected?: boolean;
  ariaLabel: string;
  px: Px;
  /** Omit for a marker that is only ever drawn, never chosen. */
  onSelect?: () => void;
}) {
  const radius = px(selected ? 11 : 8);
  return (
    <g
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={ariaLabel}
      aria-pressed={onSelect ? selected : undefined}
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
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={selected ? mapStyle.selectedFill : mapStyle.stopFill}
        stroke={mapStyle.stopRing}
        strokeWidth={px(2.5)}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={px(selected ? 12 : 10.5)}
        fontWeight={700}
        fill={selected ? mapStyle.selectedNumber : mapStyle.stopNumber}
        pointerEvents="none"
      >
        {order}
      </text>
      {/* A thumb is not eight pixels wide — the same invisible hit area
          `TripMap`'s own markers already carry. */}
      {onSelect && <circle cx={x} cy={y} r={px(22)} fill="transparent" />}
    </g>
  );
}
