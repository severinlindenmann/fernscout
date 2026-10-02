/**
 * Which real days make the golden set — B2692. Pure: given a flat list of
 * candidate days (one per published entry with words), picks up to `max`,
 * spread across trips and across short/long, with no model call and no
 * filesystem read. `build-golden.ts` is the only caller that knows what a
 * "trip" or a "day" actually is; this file only ever sees `tripId`/`words`.
 *
 * Variety, not randomness: for two runs over the same content this returns
 * the same set, which is what makes a before/after prompt comparison mean
 * anything.
 */

export type Candidate = { id: string; tripId: string; words: number };

/**
 * Round-robins across trips (so one chatty trip cannot fill the set alone)
 * and, within each trip, alternates shortest/longest remaining day (so a
 * trip written in one-liners and a trip written in essays both show up).
 *
 * ponytail: "variety" here is just word count, not language or topic — the
 * ticket's "preferring variety (short/long, languages)" leans on languages
 * differing *between* journals more than within one, which this function
 * does not see. Upgrade when a single journal actually mixes languages day
 * to day: pass a `lang` field through and alternate on it too.
 */
export function selectVariety(candidates: Candidate[], max: number): Candidate[] {
  if (max <= 0 || candidates.length === 0) return [];

  const byTrip = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byTrip.get(c.tripId) ?? [];
    list.push(c);
    byTrip.set(c.tripId, list);
  }

  // Per trip: shortest, longest, 2nd-shortest, 2nd-longest, … — a zigzag
  // in from both ends of the word-count-sorted list.
  const queues: Candidate[][] = [];
  for (const list of byTrip.values()) {
    const sorted = [...list].sort((a, b) => a.words - b.words);
    const zigzag: Candidate[] = [];
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo <= hi) {
      zigzag.push(sorted[lo]);
      if (lo !== hi) zigzag.push(sorted[hi]);
      lo += 1;
      hi -= 1;
    }
    queues.push(zigzag);
  }

  const picked: Candidate[] = [];
  let cursor = 0;
  // Round robin: one from each trip's queue per pass, in the order trips
  // were first seen, until `max` is reached or every queue is empty.
  while (picked.length < max && queues.some((q) => q.length > 0)) {
    const queue = queues[cursor % queues.length];
    cursor += 1;
    const next = queue.shift();
    if (next) picked.push(next);
  }
  return picked;
}
