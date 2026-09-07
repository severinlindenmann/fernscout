import "server-only";
import { reactionRepo } from "./repos";
import { isReaction, type Reaction } from "./reactionSet";

export * from "./reactionSet";
export type { VoteResult } from "./repos/types";
/** Exported for the tests that pin the pre-trips key migration. */
export { migrateKeys } from "./repos/reactionsFile";

/**
 * Reactions, for route handlers.
 *
 * A thin façade over `lib/repos`: the storage lives there and may be the
 * database or the `$DATA_DIR` JSON file, decided by whether `DATABASE_URL` is
 * set. Nothing in this file — or above it — knows which, and nothing knows
 * whether a database turned out to be SQLite or Postgres.
 */

/** Every day's counts for one trip, for the initial page load. */
export async function getAllCounts(tripId: string) {
  return (await reactionRepo()).getAllCounts(tripId);
}

/** What this particular reader has already picked, so their choice shows as
 * selected when they come back on another day. */
/**
 * One reader's own picks, on **one trip** — B239.
 *
 * Both storage backends answer this voter id's rows across the whole
 * journal (`reactionsDb.ts` filters by `voter_id` alone; `reactionsFile.ts`'s
 * `readVotes` reads the one file the whole journal shares), so without a
 * filter here a voter id — a `crypto.randomUUID()` that travels in a query
 * string, and so lands in access logs, `Referer` headers and any proxy in
 * between — would hand back the day slugs of every trip in the journal this
 * voter has reacted to, including closed ones the caller asking is not
 * entitled to read. `resolveReadableTrip` in the route already gates the
 * *requested* trip with `mayReadTrip`; this is what stops the answer from
 * naming trips that check was never asked about.
 *
 * Used to be `scopeToJournal`, one level looser: it kept every trip of the
 * caller's own journal rather than only the one asked about. That was never
 * exercised by the one caller there is — `ReactionsProvider` mounts one per
 * trip and asks for that trip alone — so narrowing it costs nothing the
 * client uses today.
 */
export async function getVotesFor(voterId: string, ref: string) {
  return scopeToTrip(await (await reactionRepo()).getVotesFor(voterId, ref), ref);
}

/**
 * Keeps only the votes for one trip.
 *
 * Keys are `<username>/<trip-id>:<day-slug>`, so the trip is everything
 * before the colon. A bare day slug predates multi-trip and names no trip;
 * there is nothing to scope by, and returning it unchanged keeps the older
 * single-user store working.
 */
export function scopeToTrip<T>(votes: Record<string, T>, ref: string): Record<string, T> {
  if (!ref.includes("/")) return votes;
  const prefix = `${ref}:`;
  return Object.fromEntries(Object.entries(votes).filter(([key]) => key.startsWith(prefix)));
}

/**
 * Drops the votes that belong to another journal.
 *
 * Keys are `<username>/<trip-id>:<day-slug>`, so the journal is the part
 * before the first slash. A bare id predates multi-user and names no journal;
 * there is nothing to scope by, and returning it unchanged keeps the older
 * single-user store working.
 *
 * No longer used by `getVotesFor` (see `scopeToTrip`, B239) — kept because it
 * states a real, narrower guarantee than "nothing at all" and its own test
 * pins it.
 */
export function scopeToJournal<T>(
  votes: Record<string, T>,
  ref: string,
): Record<string, T> {
  const slash = ref.indexOf("/");
  if (slash <= 0) return votes;
  const owner = `${ref.slice(0, slash)}/`;
  return Object.fromEntries(Object.entries(votes).filter(([key]) => key.startsWith(owner)));
}

/**
 * Record (or change, or withdraw) one reader's reaction to one day.
 *
 * Picking the emoji they already chose removes it, which is what every
 * reaction UI does and saves needing a separate "undo" affordance.
 */
export async function vote(
  tripId: string,
  daySlug: string,
  voterId: string,
  emoji: unknown,
) {
  if (!isReaction(emoji)) throw new Error("unknown reaction");
  return (await reactionRepo()).vote(tripId, daySlug, voterId, emoji as Reaction);
}
