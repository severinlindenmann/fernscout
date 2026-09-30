/**
 * A single-fix GPS spike — B2568, found from the owner's own 30 Sep
 * recording: at 08:03:58, as iOS woke the app, it handed over a stale
 * position stamped with a fresh time; the real fixes a second later were
 * 1.4 km on. Pure and disk-free (no `node:fs`): `DayStretchEditor.tsx` and
 * `PositionsTable.tsx` are "use client" files and may need this too.
 *
 * A spike is a fix with an impossible hop to a neighbour that is close in
 * time (under a minute), where skipping the fix leaves an ordinary speed from
 * the fix before to the fix after. A real train or flight fails the second
 * test: skipping one of its points is just as fast. Low-power bursts leave
 * minutes between most fixes, which the first test ignores. When two fixes in
 * a row both qualify (the stale one and the real one next to it), the one
 * whose removal joins two fixes closer in time is set aside.
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

/** A hop counts as a jump only between fixes this close in time; low-power
 * bursts leave minutes between most fixes, and those are never judged. */
const HOP_MAX_MS = 60_000;

/** Faster than this over one short hop is not travel: above high-speed rail
 * (~350 km/h), below the 455 km/h the real fix after the 30 Sep stale one
 * would imply if it were the one skipped. A flight sampled densely stays
 * unflagged because skipping one of its points is just as fast. */
const MAX_SANE_KMH = 400;

function kmh(a: SpikeFix, b: SpikeFix): number {
  const hours = Math.abs(b.t - a.t) / 3_600_000;
  return hours > 0 ? metresBetween(a, b) / 1000 / hours : Infinity;
}

function impossibleHop(a: SpikeFix, b: SpikeFix): boolean {
  const dt = Math.abs(b.t - a.t);
  return dt <= HOP_MAX_MS && kmh(a, b) > MAX_SANE_KMH;
}

/**
 * Which fixes in `fixes` (sorted ascending by `t`, the same order every
 * caller already keeps them in) are spikes — a `Set` of indices into the
 * array passed in, never a filtered copy: a caller needs to know *which*
 * fix to set aside, not just how many.
 */
export function spikeIndices(fixes: readonly SpikeFix[]): Set<number> {
  // Candidates: an impossible short hop on either side, and an ordinary
  // speed when the fix is skipped. Score = the speed left after skipping.
  const score = new Map<number, number>();
  for (let i = 1; i < fixes.length - 1; i++) {
    const prev = fixes[i - 1];
    const cur = fixes[i];
    const next = fixes[i + 1];
    if (!impossibleHop(prev, cur) && !impossibleHop(cur, next)) continue;
    const skipped = kmh(prev, next);
    if (skipped <= MAX_SANE_KMH) score.set(i, skipped);
  }
  const spikes = new Set<number>();
  // Two in a row: drop the one whose removal joins two fixes closer in time,
  // trusting fresh neighbours over one from hours earlier (a stale "last known
  // position" repeats an old place); equal spans fall back to the slower,
  // more ordinary joined speed.
  const span = (i: number) => fixes[i + 1].t - fixes[i - 1].t;
  const better = (a: number, b: number) => span(a) < span(b) || (span(a) === span(b) && score.get(a)! < score.get(b)!);
  for (const i of score.keys()) {
    if (score.has(i - 1) && better(i - 1, i)) continue;
    if (score.has(i + 1) && !better(i, i + 1)) continue;
    spikes.add(i);
  }
  return spikes;
}

/** The jump a spike is set aside for — its impossible short hop (to the
 * next fix if that one is, else from the previous), the pair the Positions
 * tab names: "Set aside: 1.4 km jump in 1 s". `undefined` when there is no
 * such hop. */
export function spikeJump(fixes: readonly SpikeFix[], index: number): { km: number; seconds: number } | undefined {
  if (index < 0 || index >= fixes.length) return undefined;
  const cur = fixes[index];
  const next = fixes[index + 1];
  const prev = fixes[index - 1];
  const other = next && impossibleHop(cur, next) ? next : prev && impossibleHop(prev, cur) ? prev : undefined;
  if (!other) return undefined;
  return {
    km: metresBetween(cur, other) / 1000,
    seconds: Math.round(Math.abs(other.t - cur.t) / 1000),
  };
}
