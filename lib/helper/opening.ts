import "server-only";
import { AS_AUTHOR, getAllEntries } from "../entries";
import { getTrips } from "../trips";
import { draftsForWizard } from "./server";

/**
 * What the room says before anybody has said anything — B984.
 *
 * The page this replaced was a card with four calls to action, two of them the
 * same yellow, and an owner looking at it said they felt overwhelmed. Counting
 * them explains why: a bright button to finish one day, a white box reporting
 * that *another* day was unfinished — the same fact in two shapes — two links
 * to the same room, and a second yellow button for the rarest thing on the
 * page.
 *
 * The fix is not three things instead of four. It is that a page should not
 * ask somebody to choose before they have said anything, so the opening is
 * **one sentence about what is actually there**, and an offer that follows
 * from it.
 *
 * ## Four states, because a journal is in one of four situations
 *
 * They are not moods; each is a different fact about the disk, and the copy
 * for three of them did not exist before this.
 *
 * - **`days`** — something is unfinished. The commonest state during a trip,
 *   and the only one the old page was written for.
 * - **`clear`** — everything written and on the site. The commonest state
 *   *after* one, and it used to get a generic "open the wizard" button that
 *   said nothing about the situation.
 * - **`finished`** — a trip whose days are all published and whose last day
 *   has passed. This is where a photobook and postcards stop being features
 *   somebody has to discover and become the obvious next thing.
 * - **`empty`** — no trip at all, which is what a new owner meets.
 *
 * ## Nothing here costs a model call
 *
 * It is read from disk and drawn locally. A page that spent a credit to say
 * hello would be charging somebody for arriving.
 */

/** One unfinished day, as the opening offers it. */
export type OpeningDay = {
  trip: string;
  slug: string;
  date: string;
  title: string;
  photos: number;
  written: boolean;
};

export type Opening =
  | { state: "days"; days: OpeningDay[]; more: number }
  | { state: "clear"; lastDate: string }
  | { state: "finished"; trip: string; title: string; days: number }
  /** A trip exists and not one day has been written — every new owner's
   *  second screen. B1188: it used to fall into `clear` with no last date,
   *  and the greeting read "the last of it undefined, NaN undefined". */
  | { state: "fresh"; title: string }
  | { state: "empty" };

/**
 * How many unfinished days the opening draws before it stops counting them out.
 *
 * Two, and then a number. Fifteen unfinished days must not become a wall —
 * which was the honest objection to making the days the whole page — and two
 * is what somebody would say out loud before saying "and thirteen others".
 */
const SHOWN = 2;

/** A trip nobody can add to any more: every day published, and the last one
 *  gone by. Both halves matter — a trip still running has unpublished days
 *  ahead of it that nobody has failed to write yet. */
function finished(username: string, today: string) {
  for (const trip of [...getTrips(username)].sort((a, b) => b.end.localeCompare(a.end))) {
    if (trip.end >= today) continue;
    const entries = getAllEntries(trip.ref, AS_AUTHOR);
    if (entries.length === 0) continue;
    if (entries.some((entry) => entry.draft)) continue;
    return { trip: trip.id, title: trip.title, days: entries.length };
  }
  return null;
}

export function openingFor(username: string, today: string): Opening {
  const drafts = draftsForWizard(username);
  if (drafts.length > 0) {
    return {
      state: "days",
      days: drafts.slice(0, SHOWN),
      more: Math.max(0, drafts.length - SHOWN),
    };
  }

  if (getTrips(username).length === 0) return { state: "empty" };

  /**
   * A finished trip is offered before a clear journal, and the order is the
   * decision rather than an accident: both are "nothing to write", and only
   * one of them has an obvious next thing. Somebody whose Alps trip closed
   * last week wants to hear about a photobook, not to be asked what they would
   * like to do.
   *
   * It is a guess about intent, so it is made quietly — a sentence and three
   * chips, never a prompt that comes back.
   */
  const done = finished(username, today);
  if (done) return { state: "finished", ...done };

  const trips = getTrips(username);
  const dates = trips
    .flatMap((trip) => getAllEntries(trip.ref, AS_AUTHOR).map((entry) => entry.date))
    .sort();
  const last = dates.at(-1);
  if (!last) {
    // Trips, and not one day written — B1188. "All clear, the last day
    // was <nothing>" is not a sentence; "your trip is ready" is.
    const newest = [...trips].sort((a, b) => b.start.localeCompare(a.start))[0];
    return { state: "fresh", title: newest.title };
  }
  return { state: "clear", lastDate: last };
}
