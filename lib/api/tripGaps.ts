import "server-only";
import { getAllEntries } from "../entries";
import { getTrip } from "../trips";

/**
 * What a trip is visibly missing — B532, and the second half of what the
 * import run in B531 found.
 *
 * B531 stops the *next* trip losing its money at the moment a day is written.
 * This is for the trip that already has: three readings of that journal —
 * the budget endpoint, the status call, the costs page — each had everything
 * they needed to notice that a 3500 CHF budget sat beside **zero** days
 * recording any spending, and none of them said anything. The owner found out
 * by looking at their own website.
 *
 * The same run had a second gap of the same shape. Three bookings dated
 * 28 June had nowhere to go, because no day existed for 28 June — a date
 * inside the trip's own start and end. Which dates in range carry no day is
 * arithmetic nobody was doing.
 *
 * **None of this is an error.** A trip with no money logged is a perfectly
 * ordinary trip; so is one with gaps in its days. What was missing was
 * anybody *saying so*, once, where an agent reconciling its own work would
 * read it.
 */

const DAY_MS = 86_400_000;

/** How many dates to name before summarising. A four-month upcoming trip has
 * a hundred and twenty empty days and listing them is noise, not a finding. */
const NAME_AT_MOST = 14;

export type TripGaps = {
  /** Days that carry at least one entry. */
  days: number;
  /** Of those, how many record any spending. */
  daysWithCosts: number;
  /** Dates between `start` and `end` that no entry covers — capped, see
   *  `datesWithoutADayCount` for the true number. */
  datesWithoutADay: string[];
  datesWithoutADayCount: number;
  /** Said in words when there is something to say, absent when there is not.
   *  Never phrased as a fault: a trip may legitimately be any of these. */
  note?: string;
};

/** Every date from `start` to `end`, inclusive. Both are ISO days and
 * `readTrip` refuses a trip without them, so this never runs on a half-dated
 * trip. */
function datesBetween(start: string, end: string): string[] {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const out: string[] = [];
  // A guard rather than a limit: a mistyped year would otherwise walk a
  // million days building an array nobody asked for.
  for (let at = from; at <= to && out.length < 3650; at += DAY_MS) {
    out.push(new Date(at).toISOString().slice(0, 10));
  }
  return out;
}

export function tripGaps(ref: string, hasBudget: boolean): TripGaps | null {
  const trip = getTrip(ref);
  if (!trip) return null;

  // Drafts included, deliberately: a day that is written and waiting for a
  // person is not a gap, and an agent reconciling what it wrote would be
  // told to write it twice.
  const entries = getAllEntries(ref, { includeDrafts: true });
  const dates = new Set(entries.map((e) => e.date));
  const withCosts = new Set(entries.filter((e) => e.costs.length > 0).map((e) => e.date));
  const empty = datesBetween(trip.start, trip.end).filter((date) => !dates.has(date));

  const notes: string[] = [];
  if (hasBudget && withCosts.size === 0 && dates.size > 0) {
    notes.push(
      `This trip has a budget and not one of its ${dates.size} days records any spending. ` +
        `That may be right — plenty of trips keep a budget and nothing else. If it is not, ` +
        `the day-level costs are the part that is missing, and they go on each day rather ` +
        `than here.`,
    );
  }
  if (empty.length > 0 && dates.size > 0) {
    notes.push(
      `${empty.length} date${empty.length === 1 ? "" : "s"} between ${trip.start} and ` +
        `${trip.end} carr${empty.length === 1 ? "ies" : "y"} no day at all. Anything that ` +
        `happened then has nowhere to hang — a cost belongs to a day, so a receipt from one ` +
        `of these dates needs the day written first.`,
    );
  }

  return {
    days: dates.size,
    daysWithCosts: withCosts.size,
    datesWithoutADay: empty.slice(0, NAME_AT_MOST),
    datesWithoutADayCount: empty.length,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}
