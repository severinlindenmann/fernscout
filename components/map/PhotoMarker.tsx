import { useId } from "react";
import { mapStyle } from "@/lib/map/style";
import type { Px } from "./StopMarker";

/**
 * A stop drawn as its first photo once the map is zoomed to town scale
 * (Phase 1) — a rounded square, a white border, and the same day-order
 * number badge `StopMarker` draws, so a reader who has been tracking the
 * numbers never loses them when a marker becomes a photo.
 *
 * Takes an already-resolved `src`: this primitive never fetches or chooses
 * an image. The caller filters to photos the reader may already see on that
 * day (the same reader-filtered days `tripStops` builds from) before it
 * ever reaches here.
 */
export default function PhotoMarker({
  x,
  y,
  src,
  order,
  selected = false,
  ariaLabel,
  px,
  onSelect,
}: {
  x: number;
  y: number;
  src: string;
  order: number;
  selected?: boolean;
  ariaLabel: string;
  px: Px;
  onSelect?: () => void;
}) {
  const clipId = useId();
  const size = px(selected ? 30 : 24);
  const half = size / 2;
  const corner = px(5);
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
      <defs>
        <clipPath id={clipId}>
          <rect x={x - half} y={y - half} width={size} height={size} rx={corner} />
        </clipPath>
      </defs>
      <rect
        x={x - half - px(1.5)}
        y={y - half - px(1.5)}
        width={size + px(3)}
        height={size + px(3)}
        rx={corner}
        fill={mapStyle.stopFill}
      />
      <image
        href={src}
        x={x - half}
        y={y - half}
        width={size}
        height={size}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio="xMidYMid slice"
      />
      <rect
        x={x - half}
        y={y - half}
        width={size}
        height={size}
        rx={corner}
        fill="none"
        stroke={selected ? mapStyle.selectedFill : mapStyle.stopRing}
        strokeWidth={px(2)}
      />
      <circle
        cx={x + half - px(2)}
        cy={y - half + px(2)}
        r={px(7)}
        fill={selected ? mapStyle.selectedFill : mapStyle.stopFill}
        stroke={mapStyle.stopRing}
        strokeWidth={px(1.2)}
      />
      <text
        x={x + half - px(2)}
        y={y - half + px(2)}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={px(8)}
        fontWeight={700}
        fill={selected ? mapStyle.selectedNumber : mapStyle.stopNumber}
        pointerEvents="none"
      >
        {order}
      </text>
      {onSelect && <circle cx={x} cy={y} r={px(22)} fill="transparent" />}
    </g>
  );
}
