import { kmBetween } from "../mapFrame";
import type { TransportMode } from "../../importers/gps/schema";

/**
 * The day page's two-handle time bar — B2563 T3, pure and tested apart from
 * `RangeBar.tsx`'s own drawing and drag/keyboard handling, the same split
 * `lib/map/tripFrame.ts` keeps from `WorldMap.tsx`.
 *
 * A day's own fixes (`ownerDayLine`, `lib/gps/api.ts`) come in as three
 * parallel arrays — `times` (epoch ms), `points` (`[lat, lon]`) and `modes`
 * (the phone's own guess, absent where it never said) — plus `gapAfter`,
 * which fixes join is a real gap rather than two fixes stored back to back.
 * Everything below reads `times[0]`/`times[times.length - 1]` as the bar's
 * own start/end; a day with one fix or none has no bar to draw at all, which
 * is the caller's concern, not this module's.
 */

/** Where `t` falls between `start` and `end`, 0–1, clamped. `start === end`
 * (a day with every fix at the same instant, or one fix) reads as 0 rather
 * than dividing by zero. */
export function fractionForTime(t: number, start: number, end: number): number {
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/** The inverse of `fractionForTime` — a fraction back to an instant. */
export function timeForFraction(fraction: number, start: number, end: number): number {
  return start + Math.min(1, Math.max(0, fraction)) * (end - start);
}

/** Every `gapAfter` join, as a `[fromFraction, toFraction]` pair to draw
 * dashed on the bar — D6's "no gap count", drawn instead, restated here for
 * the bar the same way `WorldMap`'s own day view already dashes gaps on the
 * map itself. */
export function gapFractions(times: readonly number[], gapAfter: readonly boolean[], start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < gapAfter.length; i++) {
    if (gapAfter[i]) out.push([fractionForTime(times[i], start, end), fractionForTime(times[i + 1], start, end)]);
  }
  return out;
}

export type SelectionStats = {
  /** Fix count strictly inside `[fromT, toT]`, inclusive. */
  positions: number;
  /** Straight-line-summed km along those fixes, in stored order — the same
   * `kmBetween` every other map/route figure in this app uses, never a
   * separate distance formula for this one card. */
  km: number;
  /** The selection's single mode, when every fix inside it agrees on one and
   * at least one fix said so — `undefined` for an empty, mixed or entirely
   * mode-less selection, which the card reads as "let the recording speak"
   * the same way `NamedStretch.mode` absent already does. */
  mode: TransportMode | undefined;
};

/** What the selection card shows and what a save's `mode` (if any) carries —
 * never a fifth distance formula, never a second "which fixes are inside
 * this range" scan. */
export function selectionStats(
  points: readonly [number, number][],
  times: readonly number[],
  modes: readonly (TransportMode | undefined)[],
  fromT: number,
  toT: number,
): SelectionStats {
  const indices: number[] = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= fromT && times[i] <= toT) indices.push(i);
  }
  let km = 0;
  for (let i = 1; i < indices.length; i++) {
    const a = points[indices[i - 1]];
    const b = points[indices[i]];
    km += kmBetween({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
  }
  const seenModes = new Set(indices.map((i) => modes[i]).filter((m): m is TransportMode => Boolean(m)));
  const mode = seenModes.size === 1 ? [...seenModes][0] : undefined;
  return { positions: indices.length, km, mode };
}
