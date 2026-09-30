/**
 * A single-fix GPS spike — B2568, found from the owner's own 30 Sep
 * recording: 08:03:59 jumped 1.44 km from the fix a second earlier, then
 * jumped straight back. Pure and disk-free (no `node:fs`), the same reason
 * `lib/gps/positionRows.ts` restates its own `metresBetween` rather than
 * importing one that pulls the store in transitively: `DayStretchEditor.tsx`
 * and `PositionsTable.tsx` are "use client" files and may need this too.
 *
 * A spike is a fix whose *neighbours* — the fix immediately before and the
 * fix immediately after it — sit close to each other in both time and
 * space (an "out and back" a phone's own receiver did in a second or two),
 * while the fix itself implies an impossible speed to reach from either one.
 * Both conditions matter: a real train or a real flight also has periods of
 * genuinely high speed, but its neighbours are never close together, because
 * it is actually still travelling when the next fix arrives — sparse points
 * from a low-power recording mode do not change that. Requiring the
 * neighbours to be close is what tells "phone glitched for one fix" apart
 * from "the owner really was moving fast".
 */

export type SpikeFix = { t: number; lat: number; lon: number };

/** Great-circle metres — restated rather than imported, the same call every
 * other pure/client-safe module in `lib/gps/` already makes (see the module
 * doc above). */
function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** How close in time the fix before and the fix after a candidate spike must
 * sit, for a jump between them to read as a glitch rather than travel — a
 * minute is generous beside the 30 Sep case's one-second neighbours, and
 * still far short of the five-minute-or-longer gaps a low-power recording's
 * own bursts leave between real fixes, which is what keeps a sparse train or
 * flight from ever reaching this branch at all. */
const NEIGHBOUR_MAX_GAP_MS = 60_000;

/** How far apart the fix before and the fix after a candidate spike may sit
 * and still count as "the same place" — generous beside ordinary GPS jitter,
 * far short of anything a real minute of travel, at any speed this app's
 * recorder ever sees, would cover. */
const NEIGHBOUR_MAX_METRES = 150;

/** Faster than this, from either neighbour, is not a speed a person carrying
 * a phone reaches — chosen below a commercial flight's cruising speed
 * (~800-900 km/h) is not required, because a flight's own neighbours are
 * never close together (see the module doc); this only has to sit above
 * anything a train does (high-speed rail tops out around 350 km/h). */
const MAX_SANE_KMH = 500;

/**
 * Which fixes in `fixes` (sorted ascending by `t`, the same order every
 * caller already keeps them in) are spikes — a `Set` of indices into the
 * array passed in, never a filtered copy: a caller needs to know *which*
 * fix to set aside, not just how many.
 */
export function spikeIndices(fixes: readonly SpikeFix[]): Set<number> {
  const spikes = new Set<number>();
  for (let i = 1; i < fixes.length - 1; i++) {
    const prev = fixes[i - 1];
    const cur = fixes[i];
    const next = fixes[i + 1];

    const neighbourGapMs = next.t - prev.t;
    if (neighbourGapMs <= 0 || neighbourGapMs > NEIGHBOUR_MAX_GAP_MS) continue;
    if (metresBetween(prev, next) > NEIGHBOUR_MAX_METRES) continue;

    const outHours = (cur.t - prev.t) / 3_600_000;
    const backHours = (next.t - cur.t) / 3_600_000;
    if (outHours <= 0 || backHours <= 0) continue;

    const outKmh = metresBetween(prev, cur) / 1000 / outHours;
    const backKmh = metresBetween(cur, next) / 1000 / backHours;
    if (outKmh > MAX_SANE_KMH && backKmh > MAX_SANE_KMH) spikes.add(i);
  }
  return spikes;
}

/** The jump a spike is set aside for — the distance and time from the fix
 * immediately before it, exactly the pair the 30 Sep example and the
 * Positions tab's own "Set aside: 1.4 km jump in 1 s" both name. `undefined`
 * for index 0 (no previous fix to jump from), which `spikeIndices` never
 * flags anyway. */
export function spikeJump(fixes: readonly SpikeFix[], index: number): { km: number; seconds: number } | undefined {
  if (index <= 0 || index >= fixes.length) return undefined;
  const prev = fixes[index - 1];
  const cur = fixes[index];
  return {
    km: metresBetween(prev, cur) / 1000,
    seconds: Math.round((cur.t - prev.t) / 1000),
  };
}
