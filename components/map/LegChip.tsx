import {
  Bike,
  Bus,
  Car,
  CarTaxiFront,
  type LucideIcon,
  Plane,
  Ship,
  Footprints,
  TrainFront,
  TrainFrontTunnel,
  TramFront,
} from "lucide-react";
import { mapStyle } from "@/lib/map/style";
import type { TransportMode } from "@/lib/types";
import type { Px } from "./StopMarker";

/** Motorbike has no dedicated lucide glyph in this app's icon set (see
 * `GamePath.tsx`'s own `ICON`), so it shares `Bike` there; this chip does
 * the same rather than inventing a second mapping to keep in sync. */
const ICON: Record<TransportMode, LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  metro: TrainFrontTunnel,
  tram: TramFront,
  bus: Bus,
  motorbike: Bike,
  bicycle: Bike,
  car: Car,
  taxi: CarTaxiFront,
  boat: Ship,
  ferry: Ship,
  walk: Footprints,
};

/**
 * A small chip at a leg's midpoint: the transport icon, and a duration
 * **only when one is passed in** — never computed from dates or invented,
 * per the content-truth rule (`AGENTS.md`).
 *
 * Decorative unless the caller passes `ariaLabel` (the leg is not
 * independently focusable in Phase 0; Phase 1 decides whether it needs to
 * be once it is actually drawn on a real map).
 */
export default function LegChip({
  x,
  y,
  mode,
  durationLabel,
  ariaLabel,
  px,
}: {
  x: number;
  y: number;
  mode: TransportMode;
  /** Already formatted by the caller — this component never computes one. */
  durationLabel?: string;
  ariaLabel?: string;
  px: Px;
}) {
  const Icon = ICON[mode];
  const iconSize = px(12);
  const padX = px(6);
  const height = px(18);
  const textWidth = durationLabel ? px(6) * durationLabel.length : 0;
  const width = iconSize + padX * 2 + (durationLabel ? textWidth + px(3) : 0);

  return (
    <g role={ariaLabel ? "img" : undefined} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      <rect
        x={x - width / 2}
        y={y - height / 2}
        width={width}
        height={height}
        rx={height / 2}
        fill={mapStyle.legChipFill}
        stroke={mapStyle.legChipBorder}
        strokeWidth={px(1)}
      />
      <Icon
        x={x - width / 2 + padX}
        y={y - iconSize / 2}
        width={iconSize}
        height={iconSize}
        color={mapStyle.legChipIcon}
      />
      {durationLabel && (
        <text
          x={x - width / 2 + padX + iconSize + px(3)}
          y={y}
          dominantBaseline="central"
          fontSize={px(9.5)}
          fill={mapStyle.legChipIcon}
        >
          {durationLabel}
        </text>
      )}
    </g>
  );
}
