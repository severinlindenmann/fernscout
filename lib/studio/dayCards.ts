/**
 * "Waiting for your words" — B2193. Photographs waiting in the inbox,
 * grouped into the days they were taken on: one card per day, a separate
 * list for photographs that carry no date, and, for a day no trip covers,
 * the dates a new trip would span. Pure, so the hub (server) and the
 * composer (client) read one rule; nothing here writes anything.
 */

/** The local calendar day a photograph was taken on, or null.
 *
 *  `takenAt` is EXIF wall-clock time with no zone (`photoMetaFromExif`), so
 *  its first ten characters are the day on the camera's own clock — a
 *  photograph at 23:50 stays on its evening, never shifted into UTC. The
 *  same reading `AddDayFlow`'s "from N photos" has always made. */
export function photoDay(takenAt: string | undefined): string | null {
  const day = takenAt?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** `?photos=` on `/studio/day/new`: a day (`2026-09-22`) or `undated`. */
export const UNDATED = "undated";

/** The photographs one card or the no-date list stands for, in list order. */
export function photosInGroup<P extends { takenAt?: string }>(photos: P[], key: string): P[] {
  return photos.filter((p) => (photoDay(p.takenAt) ?? UNDATED) === key);
}

/** B2231 — the trip a date belongs to when several cover it: the shortest
 *  range, since a short trip inside a long ongoing one is the more specific
 *  answer (a family weekend inside a year abroad). trip.json carries no
 *  creation stamp, so a tie keeps the list's order — `getTrips`'s own:
 *  the current trip first, then the most recently ended.
 *  The day cards, the composer's default and so the hub's "start a trip"
 *  run all read this one rule. */
export function tripForDate<T extends { id: string; start: string; end: string }>(date: string, trips: T[]): T | undefined {
  const span = (t: T) => Date.parse(t.end) - Date.parse(t.start);
  return trips
    .filter((t) => t.start <= date && date <= t.end)
    .sort((a, b) => span(a) - span(b))[0];
}

/** B2232 — the day page's grid holds only this day's photographs: the ones
 *  chosen or brought in for it (`keep`) and the waiting ones taken on its
 *  date. Everything else waits behind "Add more from what's waiting"; a
 *  photograph with no date never matches a day on its own. */
export function splitDayPhotos<P extends { id: string; takenAt?: string }>(
  photos: P[],
  date: string,
  keep: ReadonlySet<string>,
): { own: P[]; others: P[] } {
  const own: P[] = [];
  const others: P[] = [];
  for (const p of photos) (keep.has(p.id) || (!!date && photoDay(p.takenAt) === date) ? own : others).push(p);
  return { own, others };
}

export type WaitingPhoto = { id: string; takenAt?: string; location?: string; country?: string };
type Trip = { id: string; title: string; start: string; end: string };

type DayCard = {
  date: string;
  /** Oldest first; the first one is the card's thumbnail. */
  photoIds: string[];
  /** The place most of the day's photographs name, or null. */
  place: string | null;
  /** The trip whose dates cover this day, or null. */
  trip: { id: string; title: string } | null;
  /** Only when no trip covers the day: the run of uncovered days around it. */
  newTrip: { start: string; end: string } | null;
};

export type WaitingDays = { cards: DayCard[]; undatedIds: string[] };

/** Days apart after which two uncovered days are two trips, not one.
 *  ponytail: a gap rule, not a check against trips lying inside the run —
 *  the trip form's own overlap handling covers that rare case. */
const RUN_GAP_DAYS = 3;

function daysApart(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** The value most of `values` repeats, or null. Exported so the composer's
 *  place chip (B2227) can apply the day cards' own rule to its chosen
 *  photographs, rather than a second reading of "the place". */
export function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > counts.get(best)!) best = v;
  return best;
}

export function groupWaitingDays(photos: WaitingPhoto[], trips: Trip[]): WaitingDays {
  const byDay = new Map<string, WaitingPhoto[]>();
  const undatedIds: string[] = [];
  for (const p of photos) {
    const day = photoDay(p.takenAt);
    if (!day) undatedIds.push(p.id);
    else byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }

  const cards: DayCard[] = [...byDay.keys()].sort().map((date) => {
    const list = byDay.get(date)!.sort((a, b) => a.takenAt!.localeCompare(b.takenAt!));
    const trip = tripForDate(date, trips);
    return {
      date,
      photoIds: list.map((p) => p.id),
      place: mostCommon(list.map((p) => p.location || p.country || "").filter(Boolean)),
      trip: trip ? { id: trip.id, title: trip.title } : null,
      newTrip: null,
    };
  });

  // Runs of uncovered days: a covered day or a long gap ends one.
  let run: DayCard[] = [];
  const close = () => {
    for (const c of run) c.newTrip = { start: run[0].date, end: run[run.length - 1].date };
    run = [];
  };
  for (const card of cards) {
    if (card.trip) {
      close();
      continue;
    }
    if (run.length && daysApart(run[run.length - 1].date, card.date) > RUN_GAP_DAYS) close();
    run.push(card);
  }
  close();

  return { cards, undatedIds };
}
