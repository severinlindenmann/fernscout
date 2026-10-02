/**
 * Splitting one day's photographs into a handful of parts — TIX-2's add-a-day
 * flow, so a long day can be told a stretch at a time instead of as one wall
 * of text. Pure: no file, no store, no model — the same photograph facts
 * (`takenAt`, `lat`/`lon`) the studio already measures off the gallery, never
 * the owner's recorded GPS history.
 *
 * A new part starts at a gap of more than 3 hours on its own, or a gap of
 * more than 60 minutes *and* more than 2 km between the two photographs
 * either side of it (haversine; when either photograph carries no
 * coordinates, the distance half of that rule cannot be checked, so a plain
 * 90-minute gap rule stands in for it alone). Undated photographs are never
 * split off by themselves — they sort first and ride along with whichever
 * part follows. A part of one photograph is folded into its nearer neighbour
 * (by the gap either side) unless the gap that would isolate it is itself
 * over 3 hours, and however many parts are left are then merged, closest gap
 * first, down to at most four.
 */

export type DayPhoto = { id: string; takenAt?: string; lat?: number; lon?: number };

export type DayPart = {
  ids: string[];
  from: string | null;
  to: string | null;
  gapBeforeMinutes: number | null;
  kmBefore: number | null;
};

const MAX_PARTS = 4;
const HARD_GAP_MIN = 3 * 60;
const SOFT_GAP_MIN = 60;
const SOFT_GAP_NO_COORDS_MIN = 90;
const SOFT_GAP_KM = 2;

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** EXIF wall-clock, no zone — parsed as a plain local instant so a gap is a
 *  difference of wall-clock minutes, never shifted by the runtime's zone. */
function parseTakenAt(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

type Dated = DayPhoto & { ms: number };

/** Does the gap between consecutive dated photographs `a` and `b` start a
 *  new part? */
function isSplit(a: Dated, b: Dated): boolean {
  const gapMin = (b.ms - a.ms) / 60000;
  if (gapMin > HARD_GAP_MIN) return true;
  const hasCoords = a.lat !== undefined && a.lon !== undefined && b.lat !== undefined && b.lon !== undefined;
  if (!hasCoords) return gapMin > SOFT_GAP_NO_COORDS_MIN;
  if (gapMin <= SOFT_GAP_MIN) return false;
  const km = haversineKm({ lat: a.lat as number, lon: a.lon as number }, { lat: b.lat as number, lon: b.lon as number });
  return km > SOFT_GAP_KM;
}

/** "the morning" / "the afternoon" / "the evening", from a part's own first
 *  photo's time — B2676, the photo sheet's own header ("Add photos to the
 *  morning"). `null` (an undated part, or no `from` at all) falls back to
 *  "this part" at the call site; never a guess at a time nobody recorded. */
/** The "＋ Add photos" sheet's own Waiting tab — B2676 — ticks every one of
 *  "this day"'s own waiting photographs by default, *unless* there are more
 *  than 20 of them, in which case none are: with that many, picking is a
 *  real choice, not a wall of ticks somebody has to undo one at a time.
 *  Pure: the sheet hands it a count, not the photographs themselves. */
export function waitingSheetPreselectsAll(thisDayWaitingCount: number): boolean {
  return thisDayWaitingCount <= 20;
}

export function partTimeOfDay(from: string | null): "morning" | "afternoon" | "evening" | null {
  if (!from) return null;
  const hour = Number(from.slice(0, 2));
  if (!Number.isFinite(hour)) return null;
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function splitIntoParts(photos: readonly DayPhoto[]): { parts: DayPart[] } {
  if (photos.length === 0) return { parts: [] };

  const dated: Dated[] = [];
  const undated: DayPhoto[] = [];
  for (const p of photos) {
    const ms = p.takenAt ? parseTakenAt(p.takenAt) : null;
    if (ms === null) undated.push(p);
    else dated.push({ ...p, ms });
  }
  dated.sort((a, b) => a.ms - b.ms);

  // Undated photographs ride along with the first part rather than being
  // split off on their own — there is no instant to judge a gap from.
  if (dated.length === 0) {
    return { parts: [{ ids: photos.map((p) => p.id), from: null, to: null, gapBeforeMinutes: null, kmBefore: null }] };
  }

  // Group the dated photographs into clusters at a real gap.
  type Cluster = { items: Dated[]; gapBeforeMinutes: number | null; kmBefore: number | null };
  const clusters: Cluster[] = [{ items: [dated[0]], gapBeforeMinutes: null, kmBefore: null }];
  for (let i = 1; i < dated.length; i++) {
    const prev = dated[i - 1];
    const cur = dated[i];
    if (isSplit(prev, cur)) {
      const hasCoords = prev.lat !== undefined && prev.lon !== undefined && cur.lat !== undefined && cur.lon !== undefined;
      clusters.push({
        items: [cur],
        gapBeforeMinutes: Math.round((cur.ms - prev.ms) / 60000),
        kmBefore: hasCoords
          ? Math.round(haversineKm({ lat: prev.lat as number, lon: prev.lon as number }, { lat: cur.lat as number, lon: cur.lon as number }) * 10) / 10
          : null,
      });
    } else {
      clusters[clusters.length - 1].items.push(cur);
    }
  }

  // No part of one photograph is left split off on its own unless the gap
  // that isolates it is itself over three hours — merge it into whichever
  // neighbour sits across the smaller gap.
  function gapMinutesBetween(a: Cluster, b: Cluster): number {
    const last = a.items[a.items.length - 1];
    const first = b.items[0];
    return (first.ms - last.ms) / 60000;
  }
  function mergeClusterAt(i: number, into: number): void {
    const [removed] = clusters.splice(i, 1);
    const targetIndex = into < i ? into : into - 1;
    const target = clusters[targetIndex];
    if (into < i) {
      target.items.push(...removed.items);
    } else {
      target.items.unshift(...removed.items);
      target.gapBeforeMinutes = removed.gapBeforeMinutes;
      target.kmBefore = removed.kmBefore;
    }
  }

  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].items.length >= 2) continue;
    const gapBefore = i > 0 ? gapMinutesBetween(clusters[i - 1], clusters[i]) : null;
    const gapAfter = i < clusters.length - 1 ? gapMinutesBetween(clusters[i], clusters[i + 1]) : null;
    // A single part of exactly one photograph, isolated by a gap over three
    // hours on every side it has, stays its own part.
    const isolatedByHardGapOnly =
      (gapBefore === null || gapBefore > HARD_GAP_MIN) && (gapAfter === null || gapAfter > HARD_GAP_MIN);
    if (clusters.length === 1 || isolatedByHardGapOnly) continue;

    if (gapBefore !== null && (gapAfter === null || gapBefore <= gapAfter)) {
      mergeClusterAt(i, i - 1);
      i -= 1;
    } else if (gapAfter !== null) {
      mergeClusterAt(i, i + 1);
      i -= 1;
    }
  }

  // At most four parts — merge the closest neighbouring gap until there are
  // few enough.
  while (clusters.length > MAX_PARTS) {
    let smallest = 1;
    let smallestGap = Infinity;
    for (let i = 1; i < clusters.length; i++) {
      const gap = gapMinutesBetween(clusters[i - 1], clusters[i]);
      if (gap < smallestGap) {
        smallestGap = gap;
        smallest = i;
      }
    }
    mergeClusterAt(smallest, smallest - 1);
  }

  // Undated photographs join the first part.
  clusters[0].items.unshift(...(undated as Dated[]).map((p) => ({ ...p, ms: NaN })));

  return {
    parts: clusters.map((c) => {
      const timed = c.items.filter((p) => !Number.isNaN(p.ms));
      return {
        ids: c.items.map((p) => p.id),
        from: timed.length ? hhmm(timed[0].ms) : null,
        to: timed.length ? hhmm(timed[timed.length - 1].ms) : null,
        gapBeforeMinutes: c.gapBeforeMinutes,
        kmBefore: c.kmBefore,
      };
    }),
  };
}
