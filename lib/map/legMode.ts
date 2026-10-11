import type { TransportMode } from "../types";
import { kmBetween, type Point } from "../mapFrame";
import { groupByScreen } from "./pinGroups";
import type { MapLine, MapPlace } from "./tripFrame";

/**
 * B-2980: how a leg between stops is told apart without colour. Two source
 * vocabularies meet here: a recorded segment's mode (importers/gps/schema.ts:
 * on_foot, bike, plane ...) and an entry's own `transportMode` (lib/types.ts:
 * walk, bicycle, flight ...). Both fold into the entry names, which already
 * have labels (`studio.day.transport.*`). `unknown` and `skiing` have none,
 * so they map to null: no chip, default line. Nothing is guessed.
 */
const RECORDED_TO_LEG: Record<string, TransportMode> = {
  on_foot: "walk",
  bike: "bicycle",
  plane: "flight",
  car: "car",
  bus: "bus",
  train: "train",
  tram: "tram",
  boat: "boat",
};

const ENTRY_MODES: readonly string[] = [
  "flight", "train", "bus", "motorbike", "bicycle", "boat", "car", "taxi", "walk", "metro", "tram", "ferry",
];

export function legModeFromRecorded(mode: unknown): TransportMode | null {
  // A track file stores entry names (walk, car, train); importers say on_foot.
  return typeof mode === "string" ? (RECORDED_TO_LEG[mode] ?? legModeFromEntry(mode)) : null;
}

export function legModeFromEntry(mode: unknown): TransportMode | null {
  return typeof mode === "string" && ENTRY_MODES.includes(mode) ? (mode as TransportMode) : null;
}

export type LegPattern = "solid" | "dotted" | "dash" | "hatch" | "dashed";

/** Solid road, round dots for feet/air, long dash for bike, cross-ticks on a solid line for rail, blue dots for water. */
export function legPattern(mode: TransportMode | null | undefined): LegPattern {
  switch (mode) {
    case "walk":
    case "flight":
      return "dotted";
    case "bicycle":
      return "dash";
    case "train":
    case "metro":
    case "tram":
      return "hatch";
    case "boat":
    case "ferry":
      return "dashed";
    default:
      return "solid";
  }
}

export type LegSource = "recorded" | "day";

/** Whether a leg's own line style already says its mode, so a chip adds nothing (the plain road). */
export const chipRedundant = (mode: TransportMode): boolean => mode === "car";

/** Midpoint of a leg's longest straight piece: where its chip sits. */
export function longestSegmentMid(coords: readonly Point[]): Point | null {
  let best = -1;
  let mid: Point | null = null;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const len = Math.hypot(b.lat - a.lat, (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)));
    if (len > best) {
      best = len;
      mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    }
  }
  return mid;
}

export type ChipCandidate<T = unknown> = { x: number; y: number; data: T };

/**
 * Which chips survive on screen: none within `minDist` px of a stop or photo
 * pin (`blockers`), and of two chips that collide the first wins (reuses the
 * greedy screen grouping the photo pins use).
 */
export function placeChips<T>(
  chips: readonly ChipCandidate<T>[],
  blockers: readonly { x: number; y: number }[],
  minDist: number,
): ChipCandidate<T>[] {
  const free = chips.filter((c) => !blockers.some((b) => Math.hypot(b.x - c.x, b.y - c.y) < minDist));
  return groupByScreen(free, minDist).map((g) => g[0]);
}

/**
 * B-2980: lines plus the legs a day's own `transportMode` declares. The first
 * recorded run into a day, without a mode of its own, takes the day's, tagged "day". Between two
 * consecutive placed days with no recording into the later one, the later
 * day's mode draws a straight join tagged "day" (an existing photo join just
 * gains the mode). Legs over 600 km stay the overview's flights.
 * ponytail: "recorded into the later day" means any recorded line on that
 * day; a recording that only covers part of the way still suppresses the join.
 */
export function withDeclaredLegs(
  lines: readonly MapLine[],
  places: readonly MapPlace[],
  declared: ReadonlyMap<number, TransportMode>,
): MapLine[] {
  // The day's mode goes onto the first recorded line into that day only (the
  // leg that got there), never onto every run of a day of walks (B-2980).
  const given = new Set<number>();
  const out: MapLine[] = lines.map((l) => {
    // A flight arc is geometry; it is said to be a flight only by a plane in
    // the recording around it, or by the arrival day's own entry — else no chip.
    if (l.kind === "flight" && !l.mode) {
      if (lines.some((o) => o.kind === "recorded" && o.mode === "flight" && (o.toDay === l.fromDay || o.toDay === l.toDay)))
        return { ...l, mode: "flight" as const, modeSource: "recorded" as const };
      return declared.get(l.toDay) === "flight" ? { ...l, mode: "flight" as const, modeSource: "day" as const } : l;
    }
    if (l.kind !== "recorded" || l.mode || !declared.has(l.toDay) || given.has(l.toDay)) return l;
    // A join or flight already carries the way into that day.
    if (lines.some((o) => (o.kind === "flight" || o.kind === "photo-join") && o.toDay === l.toDay)) return l;
    given.add(l.toDay);
    return { ...l, mode: declared.get(l.toDay), modeSource: "day" as const };
  });
  const sorted = [...places].sort((a, b) => a.day - b.day);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const mode = declared.get(b.day);
    const km = kmBetween(a, b);
    if (!mode || (a.home && b.home) || km < 0.05 || km > 600) continue;
    const at = out.findIndex((l) => l.kind === "photo-join" && l.fromDay === a.day && l.toDay === b.day);
    if (at >= 0) out[at] = { ...out[at], mode, modeSource: "day" };
    else if (!out.some((l) => l.kind === "recorded" && l.toDay === b.day))
      out.push({ kind: "photo-join", fromDay: a.day, toDay: b.day, coords: [a, b], count: 1, mode, modeSource: "day" });
  }
  return out;
}

/**
 * B-2980: the modes the legend lists — those of the WHOLE trip (recorded and
 * declared legs on every day, on every day), never just the selected
 * day's. `selected` marks the modes the selected day itself travelled by.
 */
export function legendModes(
  lines: readonly { kind: string; mode?: TransportMode | null; fromDay: number; toDay: number }[],
  selectedDay: number | null,
): { mode: TransportMode; pattern: LegPattern; selected: boolean }[] {
  const seen = new Map<TransportMode, boolean>();
  for (const l of lines) {
    if (!l.mode || l.kind === "gap") continue;
    const mine = selectedDay !== null && (l.fromDay === selectedDay || l.toDay === selectedDay);
    seen.set(l.mode, (seen.get(l.mode) ?? false) || mine);
  }
  return [...seen].map(([mode, selected]) => ({ mode, pattern: legPattern(mode), selected }));
}
