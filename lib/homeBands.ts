import type { HomeJournal, HomeTrip } from "@/components/HomeJournals";

/**
 * Which trips `/` leads with — B-2975.
 *
 * Pure and client-safe: the home answer is kept in the offline cache, so the
 * `status` inside it is as old as the saved copy. "Running" is therefore
 * decided here, on the device, from `start` and `end` and the reader's own
 * date — the server's `status` only stands in for a trip with no `start`.
 *
 * "Running" is a fact about dates, never about the traveller: nothing here says
 * somebody is moving, and the page labels the band "by trip dates".
 */

export type BandTrip = { journal: HomeJournal; trip: HomeTrip };

/** A running trip with nothing dated or started this recently is "quiet". */
const QUIET_AFTER_DAYS = 10;

/** At most this many upcoming trips are named on `/`. */
const UPCOMING_SHOWN = 2;

type Phase = "running" | "upcoming" | "past";

export function phaseOf(trip: HomeTrip, today: string): Phase {
  if (!trip.start || !trip.end) return trip.status === "current" ? "running" : (trip.status ?? "past");
  if (today < trip.start) return "upcoming";
  if (today > trip.end) return "past";
  return "running";
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Dated or started within `QUIET_AFTER_DAYS` of today. A day dated in the
 * future counts as fresh: a reader's today may trail the writer's. */
function isFresh(trip: HomeTrip, today: string): boolean {
  const last = trip.latest?.date ?? trip.start;
  return last ? daysBetween(last, today) <= QUIET_AFTER_DAYS : false;
}

/** Newest readable day first, then the newest start. */
function byNewest(a: BandTrip, b: BandTrip): number {
  return (
    (b.trip.latest?.date ?? "").localeCompare(a.trip.latest?.date ?? "") ||
    (b.trip.start ?? "").localeCompare(a.trip.start ?? "")
  );
}

/** A trip the address is on, or one in a journal it owns. */
function isOwn({ journal, trip }: BandTrip): boolean {
  return journal.role === "owner" || trip.through === "owner" || trip.through === "traveller";
}

export type Bands = {
  /** The reader's own trips that need them: running, or holding a draft. */
  mine: BandTrip[];
  /** Friends' running trips with something recent, newest first. */
  running: BandTrip[];
  /** Friends' running trips with nothing recent. */
  quiet: BandTrip[];
  /** The next few trips that have not started, soonest first. */
  upcoming: BandTrip[];
  /** Past trips, per journal, for the folded lines. */
  earlier: { journal: HomeJournal; count: number; own: boolean }[];
};

export function bandsFor(journals: HomeJournal[], today: string): Bands {
  const all: BandTrip[] = journals
    .filter((journal) => journal.role !== "admin")
    .flatMap((journal) => journal.trips.map((trip) => ({ journal, trip })))
    // A rehearsal nobody lived is never "on the road".
    .filter(({ trip }) => !trip.test);

  const mine: BandTrip[] = [];
  const running: BandTrip[] = [];
  const quiet: BandTrip[] = [];
  const upcoming: BandTrip[] = [];
  const past = new Map<string, number>();

  for (const item of all) {
    const phase = phaseOf(item.trip, today);
    const own = isOwn(item);
    // The owner's unfinished draft stays reachable after its trip ends.
    if (own && (phase === "running" || item.trip.draft)) mine.push(item);
    if (phase === "running" && !own) (isFresh(item.trip, today) ? running : quiet).push(item);
    else if (phase === "upcoming") upcoming.push(item);
    else if (phase === "past") past.set(item.journal.username, (past.get(item.journal.username) ?? 0) + 1);
  }

  const earlier = journals
    .filter((journal) => (past.get(journal.username) ?? 0) > 0)
    .map((journal) => ({
      journal,
      count: past.get(journal.username) ?? 0,
      own: journal.role === "owner",
    }))
    // Yours first, then the others as the answer already orders them.
    .sort((a, b) => Number(b.own) - Number(a.own));

  return {
    mine: mine.sort((a, b) => Number(Boolean(b.trip.draft)) - Number(Boolean(a.trip.draft)) || byNewest(a, b)),
    running: running.sort(byNewest),
    quiet: quiet.sort(byNewest),
    upcoming: upcoming.sort((a, b) => (a.trip.start ?? "").localeCompare(b.trip.start ?? "")).slice(0, UPCOMING_SHOWN),
    earlier,
  };
}

/** The newest published day across everything this address may read — what a
 * quiet page offers in place of a running trip. */
export function newestDay(journals: HomeJournal[]): BandTrip | undefined {
  return journals
    .filter((journal) => journal.role !== "admin")
    .flatMap((journal) => journal.trips.map((trip) => ({ journal, trip })))
    .filter(({ trip }) => trip.latest && !trip.test)
    .sort(byNewest)[0];
}
