/**
 * Which days the story page still has to fetch.
 *
 * The page ships a window of full days around wherever the reader arrived and
 * fetches the neighbours as they move (see `app/TripStory.tsx` and
 * `/<user>/story.json`). The bookkeeping for that — what has been asked for,
 * and what may be asked for again — lives here rather than inside the effect,
 * because it was wrong and none of it needs a browser to be wrong in. The same
 * reasoning, and the same class of bug, as `lib/whatsNew.ts`.
 *
 * What was wrong: a range was marked as requested before the fetch went out and
 * unmarked only when the fetch *failed*. A fetch that was neither answered nor
 * failed — aborted, because React had torn the effect down — left its days
 * marked forever, and nothing asked for them again. The reader got "this day is
 * loading…" and no further requests, permanently.
 *
 * That landed on day one of every trip, every time. The reader opens on the
 * overview, which reports day 0 as the day in view, so the first thing the
 * effect ever does is request the window around day 0; React then remounts
 * effects on mount in development, aborting exactly that request and no other.
 * The days the server had already sent — the window around today, at the far
 * end of the trip — were in hand and rendered fine, which is what made it look
 * like only the first day was broken. In production the same hole opens
 * whenever the reader moves while a window is in flight.
 */

/** A half-open range of positions in the day index: `start` … `end - 1`. */
export type DayRange = { start: number; end: number };

/** Where the reader is, how far to look, and what is already in hand. */
export type WindowQuery = {
  /** The day in view, as a position in the trip's day index. */
  centre: number;
  /** How many days the trip has. */
  length: number;
  /** How many days either side of `centre` to keep loaded. */
  radius: number;
  /** True for a day whose full content has already arrived. */
  has: (index: number) => boolean;
};

export class WindowLedger {
  /** Positions with a request already out for them. */
  private readonly asked = new Set<number>();

  /**
   * The next range to request, or null when the reader's window is covered.
   *
   * One range spanning the whole gap rather than one request per day: the days
   * in the middle of it may already be in hand, and re-sending a couple of them
   * costs less than a second round trip.
   */
  plan({ centre, length, radius, has }: WindowQuery): DayRange | null {
    const from = Math.max(0, centre - radius);
    const to = Math.min(length, centre + radius + 1);

    let start = -1;
    let last = -1;
    for (let i = from; i < to; i++) {
      if (has(i) || this.asked.has(i)) continue;
      if (start < 0) start = i;
      last = i;
    }
    return start < 0 ? null : { start, end: last + 1 };
  }

  /** Records that a request for this range is on its way. */
  claim({ start, end }: DayRange): void {
    for (let i = start; i < end; i++) this.asked.add(i);
  }

  /**
   * Gives the range back, so {@link plan} will offer it again.
   *
   * For a request that was never answered — aborted, or failed. Releasing an
   * aborted range has to happen while the abort does, not when its rejection
   * eventually arrives: React tears an effect down and sets it back up in the
   * same turn, and by the time a promise rejection is delivered the new setup
   * has already asked what is missing and been told "nothing".
   */
  release({ start, end }: DayRange): void {
    for (let i = start; i < end; i++) this.asked.delete(i);
  }
}
