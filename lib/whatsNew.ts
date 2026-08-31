/**
 * "4 new days since your last visit" — the banner on a trip's hero.
 *
 * The arithmetic and the storage key names live here rather than inside
 * TripStory because both were wrong, and neither needs a browser to be wrong
 * in. What the component still owns is touching web storage; what it asks this
 * module is only ever "given what I read, what should the hero say".
 */

/** Just the field any of this cares about. `DaySummary` satisfies it. */
type Dated = { date: string };

/**
 * Where a trip's reading marks are kept, scoped to that trip.
 *
 * The value stored under this key is an entry date, not a wall-clock stamp:
 * "new since you were here" then survives clock skew and lines up with how the
 * entries are dated.
 *
 * The scoping is the point. `index` is one trip's days, so a mark taken while
 * reading another trip says nothing about this one — and while both trips
 * shared a single `fs.lastVisit`, opening an older trip rewound the mark to
 * that trip's last day, after which the current trip announced its whole run
 * as new. Every visit. A ref (`<username>/<trip-id>`) rather than a trip id
 * because ids are unique within a journal, not across the instance.
 */
export function lastVisitKey(ref: string): string {
  return `fs.lastVisit:${ref}`;
}

/** Where the reader had got to, for the hero's Continue button. Same scoping,
 * for the same reason: Continue used to offer a day from a different trip. */
export function resumeKey(ref: string): string {
  return `fs.lastDay:${ref}`;
}

/**
 * Where this visit's *starting* mark is kept — in sessionStorage, not local.
 *
 * Arriving stamps `lastVisitKey` forward to the newest day, which destroys the
 * only record of what the reader had seen. That was survivable while the
 * banner was computed once on mount, and it stopped being survivable the
 * moment the component remounted: the second mount read back its own stamp and
 * the banner vanished. `next dev` remounts every page, which is why the
 * feature worked in production and never once locally.
 *
 * So the answer to "what had they seen when this visit began" is written down
 * once per tab and read by every mount, instead of being inferred from a value
 * we have already overwritten. It is cleared, not updated, once the reader
 * reaches one of the new days — after which the stamped mark is the truth
 * again.
 */
export function visitMarkKey(ref: string): string {
  return `fs.visit:${ref}`;
}

/**
 * The mark this visit started from.
 *
 * @param session what {@link visitMarkKey} holds — null if this visit has not
 *                recorded one yet, `""` if it recorded that there was none
 * @param stored  what {@link lastVisitKey} holds
 *
 * The empty string is load-bearing: "this visit found no previous mark" and
 * "this visit has not looked yet" are different answers, and only the second
 * one may consult localStorage — by the time a remount asks, localStorage has
 * been stamped and would claim the reader was up to date.
 */
export function visitMark(session: string | null, stored: string | null): string {
  return session ?? stored ?? "";
}

/**
 * The unscoped names these replaced.
 *
 * Nothing reads them. They are listed so the component can clear them: a value
 * left behind under the old name is a trip-contaminated mark, and the only
 * thing worse than deleting it is a later reader of this code believing it.
 */
export const LEGACY_KEYS = ["fs.lastVisit", "fs.lastDay"] as const;

/** The trip's latest day — the mark to stamp for next time. "" for no days. */
export function newestDate(days: readonly Dated[]): string {
  return days.reduce((max, d) => (d.date > max ? d.date : max), "");
}

/**
 * What the hero should say about days published since the reader was last here.
 *
 * @param days      every day of this trip
 * @param lastVisit the newest day that existed at their last visit, or null
 *                  for a first-time reader
 * @param reached   the newest day they have opened during this visit, or null
 *                  if they have not left the hero
 *
 * `firstIndex` is where "Show me" jumps to; `count` is the number in the
 * sentence. `{ firstIndex: -1, count: 0 }` means say nothing, and it is the
 * answer in three cases worth naming:
 *
 *  - **A first-time reader.** Every day is new and the line would tell them
 *    nothing they can act on.
 *  - **A reader who has read one of the new days.** The prompt has done its
 *    job. It deliberately does not vanish the instant they land on the hero —
 *    that was the original intent and it stands — but it must go once they
 *    have taken it up, or pressing Overview brings back an offer they already
 *    accepted.
 *  - **A mark at or past the trip's end**, which a half-migrated browser can
 *    still be holding. Nothing new, rather than a negative count.
 */
export function whatsNew(
  days: readonly Dated[],
  lastVisit: string | null,
  reached: string | null,
): { firstIndex: number; count: number } {
  const nothing = { firstIndex: -1, count: 0 };
  if (!lastVisit) return nothing;
  // Reaching a day newer than the mark *is* reading the new days, whichever
  // one of them they landed on.
  if (reached && reached > lastVisit) return nothing;
  const firstIndex = days.findIndex((d) => d.date > lastVisit);
  if (firstIndex < 0) return nothing;
  // Counted rather than measured from `firstIndex`, because an index that is
  // not in date order would otherwise report more days than are actually new.
  const count = days.filter((d) => d.date > lastVisit).length;
  return { firstIndex, count };
}
