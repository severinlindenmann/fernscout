/**
 * "Today", for a journal whose days are calendar dates and whose reader is not
 * where the author was.
 *
 * An entry's `date` is a plain `YYYY-MM-DD`, and it means the author's local
 * calendar day — the day they had, in Hanoi or Tbilisi or wherever they were
 * standing. It carries no zone and never has. Every comparison against "now"
 * therefore has to choose a calendar to be right in, and until this module the
 * code chose UTC everywhere by way of `new Date().toISOString().slice(0, 10)`,
 * which is nobody's calendar: not the author's, not the reader's.
 *
 * That is a real, visible, seven-hour bug rather than a pedantic one. An author
 * in Hanoi (UTC+7) publishing at half past midnight on the 15th is publishing
 * on a date that UTC still calls the 14th, so a filter of `date <= utcToday`
 * treats their newest entry as being in the future and hides it until early
 * evening, local time. It also runs the other way: a reader in Auckland
 * (UTC+13) reading at ten in the morning is told a trip starting "today" is
 * still a day away, because UTC has not got there yet.
 *
 * There are two questions here and they want two different calendars.
 *
 * **"Has this day happened yet?"** — the question behind which day to land on
 * and what to list. Answered in the *earliest* calendar in use anywhere on
 * earth (UTC+14, Kiritimati). The set being filtered contains only days that
 * have actually been written, so erring early can at worst show a real entry a
 * few hours before its author's midnight, while erring late hides something
 * that exists and is the whole point of the visit. Hiding published work is
 * the expensive mistake; showing it early is not.
 *
 * **"How many days until the trip starts?"** — a number said out loud to the
 * person holding the phone. Answered in *their* calendar, because that is the
 * one their phone's lock screen agrees with, and a countdown that disagrees
 * with the device it is displayed on is simply wrong to its reader.
 *
 * Everything takes `now` as an argument so it can be tested, and so that
 * callers rendering on both sides of hydration are forced to notice that they
 * are reading a clock.
 */

import type { TripStatus } from "./types";

/** Kiritimati, UTC+14 — the furthest ahead any inhabited calendar runs. */
export const MAX_UTC_OFFSET_HOURS = 14;

const DAY_MS = 86_400_000;

function isoFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The latest calendar date that has begun anywhere on earth.
 *
 * Use for "may this be shown yet". Never hides a published day.
 */
export function earliestTodayISO(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + MAX_UTC_OFFSET_HOURS * 3_600_000);
  return isoFromParts(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * The calendar date on the reader's own device.
 *
 * Use for anything phrased as "today" or counted in days to the reader. Reads
 * the host's zone, so on a server it is the server's — which is why the two
 * components that call it do so after mount rather than during render.
 */
export function readerTodayISO(now: Date = new Date()): string {
  return isoFromParts(now.getFullYear(), now.getMonth(), now.getDate());
}

/** A `YYYY-MM-DD` as a UTC midnight, for arithmetic between two calendar
 * dates. Only ever compared against another value from this same function, so
 * the choice of UTC is a convention rather than a claim about zones. */
function calendarMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/**
 * Whole days from the reader's today to a calendar date. Never negative — a
 * start date in the past is `0`, i.e. "it has begun".
 */
export function daysUntil(dateISO: string, now: Date = new Date()): number {
  const from = calendarMs(readerTodayISO(now));
  const to = calendarMs(dateISO);
  if (!Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

/** Whether a day dated `dateISO` has begun somewhere. See `earliestTodayISO`. */
export function hasHappened(dateISO: string, now: Date = new Date()): boolean {
  return dateISO <= earliestTodayISO(now);
}

/** Whether a date is the reader's own today, for a "Today" marker. */
export function isReaderToday(dateISO: string, now: Date = new Date()): boolean {
  return dateISO === readerTodayISO(now);
}

/**
 * `past` or `upcoming` for a trip, from its dates and nothing else.
 *
 * The line is `start`, not `end`: everything the two words decide is really
 * the question "is there anything to read yet?", and the answer flips the day
 * the trip begins, not the day it ends. A trip under way that nobody declared
 * `current` therefore reads as `past` — the bucket that means "shows its
 * days", which is the safe side of a wrong guess. Calling a running trip
 * `upcoming` hides every day written to it (B72); calling it `past` shows
 * them under a heading that is a few weeks early.
 *
 * Asked in the earliest calendar in use anywhere on earth, like `hasHappened`
 * and for the same reason: the mistake worth avoiding is hiding a published
 * day, never showing one a few hours early.
 */
export function calendarStatus(trip: { start: string }, now: Date = new Date()): TripStatus {
  return hasHappened(trip.start, now) ? "past" : "upcoming";
}

/**
 * The status a trip actually has, reconciling what it declares with the
 * calendar.
 *
 * `status:` in a trip.md is **one** editorial choice and two facts. `current`
 * is the choice — which of a journal's trips the bare `/<user>` URLs serve —
 * and no date arithmetic can make it or take it away, so it is honoured as
 * written. `past` and `upcoming` are not choices at all: they are what `start`
 * says about today, and a field nobody has edited since the trip was created
 * is the worst available source for them.
 *
 * B72 is what deriving them costs when it is not done. A trip was created
 * through the write API with dates in the past and no status, took the
 * `upcoming` default, and a week later still rendered a countdown over three
 * published days — days the feed, the search index and the trip page had all
 * skipped on the strength of that one word.
 */
export function effectiveStatus(
  trip: { start: string; status: TripStatus },
  now: Date = new Date(),
): TripStatus {
  if (trip.status === "current") return "current";
  return calendarStatus(trip, now);
}

/**
 * Whether a trip has started — whether there is any "so far" to talk about.
 *
 * The mirror of `isOver`, and the question every "how are we doing" figure
 * quietly assumes an answer to: spend per day, pace against a budget, a
 * projected total. Before departure each of those is arithmetic over an empty
 * set, and the zero it produces reads as a measurement rather than as an
 * absence — B19 is a costs page for a trip fourteen months away reporting a
 * daily average, a percentage of the budget used and a projected total an
 * order of magnitude below the budget itself.
 *
 * `status` settles it the way it settles `isOver`, through the same
 * reconciliation: `current` is the author's own word and is honoured as
 * written, while `past` and `upcoming` are `effectiveStatus`'s reading of
 * `start` rather than a field nobody has edited since the trip was created
 * (B72).
 *
 * `days` is the guard against the opposite error, and the counterpart of the
 * one in `isOver`: an author who left early — the flight moved, and nobody
 * edited the frontmatter — is travelling whatever `start` claims, and a day
 * already written to the trip says so. Days *dated ahead* do not count, in the
 * earliest calendar in use anywhere on earth: an entry for a day that has not
 * arrived is still a plan, whoever wrote it.
 */
export function hasBegun(
  trip: { start: string; status: TripStatus },
  days: { date: string }[] = [],
  now: Date = new Date(),
): boolean {
  if (effectiveStatus(trip, now) !== "upcoming") return true;
  return days.some((day) => hasHappened(day.date, now));
}

/**
 * Whether a trip is done — nothing more coming, only what's already written.
 *
 * `status` settles the question outright at both ends, and by the time a
 * `Trip` reaches here that status has already been through `effectiveStatus`:
 * `past` and `upcoming` are the calendar's own reading of `start`, and
 * `current` is the one word an author declares. So the two early returns are
 * not a second opinion about the dates — they are "this trip is not the one
 * under way", answered before any arithmetic.
 *
 * For the trip that *is* current, this is the same question `hasHappened` answers for a single
 * day, asked of the trip's `end:` date instead — so it errs the same
 * direction, in the same calendar: the earliest one in use anywhere on earth,
 * not the reader's own. Calling a trip over a few hours before the author's
 * own midnight is a minor overstatement; leaving it "live", pulsing dot and
 * all, for days after it has plainly wrapped up is the mistake that actually
 * misleads a reader — the one this function exists to stop.
 *
 * `days` is the guard against the opposite error: an author who kept writing
 * past their own planned `end:` (the trip ran long, and nobody edited the
 * frontmatter) is still travelling, whatever the plan said. A last entry
 * dated after `end` keeps the trip live regardless of what the date alone
 * would say.
 */
export function isOver(
  trip: { end: string; status: TripStatus },
  days: { date: string }[],
  now: Date = new Date(),
): boolean {
  if (trip.status === "past") return true;
  if (trip.status === "upcoming") return false;
  if (!hasHappened(trip.end, now)) return false;
  const lastDate = days.at(-1)?.date;
  return !(lastDate && lastDate > trip.end);
}
