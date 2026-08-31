/**
 * Grouping a pile of photographs into candidate entries.
 *
 * The unit of a travel blog is "a day, or a stop within a day". A folder off a
 * camera is neither — it is 300 files. Clustering guesses the boundaries so
 * the author edits titles instead of sorting files, which is the difference
 * between a ten-minute write-up and an hour of dragging thumbnails.
 *
 * Three signals, in the order they matter:
 *
 *  - **The calendar date changes.** Always a new entry. Days are how the site
 *    is organised, so this is not a heuristic, it is the structure.
 *  - **A long gap in time.** Morning temple, evening market: same date,
 *    different thing. Anything over a few hours reads as a separate stop.
 *  - **A long jump in space.** You got on a train. Distance is measured
 *    against the cluster's running centre rather than the previous photo, so
 *    one bad GPS fix does not split a lunch into three entries.
 *
 * Everything here is pure — no filesystem, no EXIF, no sharp — because the
 * boundaries are the part most worth having tests for.
 */
import { distanceKm } from "./geo.ts";

export type Locatable = {
  /** Wall-clock milliseconds, as `wallClockMs` produces them. */
  takenAtMs: number;
  lat?: number;
  lng?: number;
};

export type ClusterOptions = {
  /** Hours of silence that start a new entry within the same day. */
  gapHours?: number;
  /** Kilometres from the cluster's centre that start a new entry. */
  splitKm?: number;
};

export const DEFAULT_GAP_HOURS = 5;
export const DEFAULT_SPLIT_KM = 30;

export type Cluster<T> = {
  /** ISO yyyy-mm-dd, from the first item in the cluster. */
  date: string;
  items: T[];
  /** Median position of the located items, or undefined if none had a fix. */
  lat?: number;
  lng?: number;
};

/** `wallClockMs` builds its value with `Date.UTC`, so this reads it back
 * exactly, with no zone anywhere in the round trip. */
export function dateOf(takenAtMs: number): string {
  return new Date(takenAtMs).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Gives un-located items the position of the nearest photo in time that has
 * one.
 *
 * This is the mixed-camera case and it is extremely common: the phone knows
 * where it is, the mirrorless body does not, and both were in the same bag.
 * Interpolating across a whole trip would be nonsense, so a borrowed fix is
 * only accepted from within a few hours.
 */
export function fillMissingCoordinates<T extends Locatable>(
  items: T[],
  withinHours = 3,
): T[] {
  const located = items.filter((i) => i.lat !== undefined && i.lng !== undefined);
  if (located.length === 0) return items;
  const window = withinHours * 3_600_000;

  return items.map((item) => {
    if (item.lat !== undefined && item.lng !== undefined) return item;
    let best: T | undefined;
    let bestGap = Infinity;
    for (const candidate of located) {
      const gap = Math.abs(candidate.takenAtMs - item.takenAtMs);
      if (gap < bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
    if (!best || bestGap > window) return item;
    return { ...item, lat: best.lat, lng: best.lng };
  });
}

/** Sorts by time and cuts the sequence into candidate entries. */
export function clusterMedia<T extends Locatable>(
  items: T[],
  options: ClusterOptions = {},
): Cluster<T>[] {
  const gapMs = (options.gapHours ?? DEFAULT_GAP_HOURS) * 3_600_000;
  const splitKm = options.splitKm ?? DEFAULT_SPLIT_KM;

  const sorted = [...items].sort((a, b) => a.takenAtMs - b.takenAtMs);
  const clusters: Cluster<T>[] = [];

  let current: T[] = [];
  let centreLat = 0;
  let centreLng = 0;
  let located = 0;

  const flush = () => {
    if (current.length === 0) return;
    const lats = current.filter((i) => i.lat !== undefined).map((i) => i.lat!);
    const lngs = current.filter((i) => i.lng !== undefined).map((i) => i.lng!);
    clusters.push({
      date: dateOf(current[0].takenAtMs),
      items: current,
      lat: lats.length ? median(lats) : undefined,
      lng: lngs.length ? median(lngs) : undefined,
    });
    current = [];
    centreLat = 0;
    centreLng = 0;
    located = 0;
  };

  /** Is this photo further from the cluster's centre than the split allows? */
  const farFromCentre = (item: T | undefined): boolean => {
    if (!item || located === 0 || item.lat === undefined || item.lng === undefined) return false;
    return distanceKm(centreLat / located, centreLng / located, item.lat, item.lng) > splitKm;
  };

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    let outlier = false;

    if (current.length > 0) {
      const previous = current[current.length - 1];
      const newDay = dateOf(item.takenAtMs) !== dateOf(previous.takenAtMs);
      const longGap = item.takenAtMs - previous.takenAtMs >= gapMs;

      let moved = false;
      if (!newDay && !longGap && farFromCentre(item)) {
        // What tells a bad fix from a journey is what happens next. Phones
        // throw out a wild reading indoors and then come straight back, so a
        // far photo followed by a near one is noise; a far photo followed by
        // another far one — or by nothing, because the day ended there — is
        // the train you got on. Without this, one stray fix over lunch turns
        // one entry into three.
        const next = sorted[i + 1];
        outlier = next !== undefined && !farFromCentre(next);
        moved = !outlier;
      }

      if (newDay || longGap || moved) flush();
    }

    current.push(item);
    // An outlier stays in the entry it was taken during but is kept out of the
    // centre, so it cannot drag the next comparison with it.
    if (!outlier && item.lat !== undefined && item.lng !== undefined) {
      centreLat += item.lat;
      centreLng += item.lng;
      located += 1;
    }
  }
  flush();

  return clusters;
}
