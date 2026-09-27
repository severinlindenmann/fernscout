import type { TripAccent } from "@/lib/types";

/**
 * Every colour an SVG map draws, as `var(--map-…)` references onto the
 * tokens in `app/globals.css` — never a hex. B2417 (Phase 0 of
 * docs/plans/map-redesign.md); no component reads these yet, Phase 1
 * (B2418+) restyles TripMap/WorldMap/LifetimeMap/SlideMap onto them.
 */
export const mapStyle = {
  land: "var(--map-land)",
  sea: "var(--map-sea)",
  water: "var(--map-water)",
  border: "var(--map-border)",
  borderInternal: "var(--map-border-internal)",
  ice: "var(--map-ice)",
  road: "var(--map-road)",
  roadCasing: "var(--map-road-casing)",
  stopFill: "var(--map-stop-fill)",
  stopRing: "var(--map-stop-ring)",
  stopNumber: "var(--map-stop-number)",
  selectedFill: "var(--map-selected-fill)",
  selectedNumber: "var(--map-selected-number)",
  hereNow: "var(--map-here-now)",
  hereNowHalo: "var(--map-here-now-halo)",
  clusterFill: "var(--map-cluster-fill)",
  clusterText: "var(--map-cluster-text)",
  routeCasing: "var(--map-route-casing)",
  plannedLeg: "var(--map-planned-leg)",
  legChipFill: "var(--map-leg-chip-fill)",
  legChipBorder: "var(--map-leg-chip-border)",
  legChipIcon: "var(--map-leg-chip-icon)",
  labelStop: "var(--map-label-stop)",
  labelStopHalo: "var(--map-label-stop-halo)",
  labelTown: "var(--map-label-town)",
  labelPeak: "var(--map-label-peak)",
  controlFill: "var(--map-control-fill)",
  controlIcon: "var(--map-control-icon)",
  controlShadow: "var(--map-control-shadow)",
} as const;

const ACCENT_VAR: Record<TripAccent, string> = {
  sky: "var(--map-accent-sky)",
  yellow: "var(--map-accent-yellow)",
  green: "var(--map-accent-green)",
  coral: "var(--map-accent-coral)",
  navy: "var(--map-accent-navy)",
};

/** A trip's accent, as its map-only step (Q2, docs/plans/map-redesign.md
 * §7) — one notch darker than `ACCENT_HEX` (`lib/types.ts`) for sky and
 * yellow, which fail 3:1 on `--map-land` at their brand hex; unchanged in
 * hue for green, coral and navy. */
export function mapAccent(accent: TripAccent): string {
  return ACCENT_VAR[accent];
}
