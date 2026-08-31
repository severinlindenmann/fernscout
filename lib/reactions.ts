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
 * One reader's own picks, across the trips of **one journal**.
 *
 * Spanning trips is deliberate: one browser has one voter id, and the story
 * pager wants to know what this reader already reacted to without a request
 * per trip. Spanning *journals* is not — `owner_id` on the table is a constant
 * and the qualified ref is the tenant boundary (lib/db/owner.ts), so an
 * unscoped answer handed one journal's page a list of the trips this visitor
 * reads on somebody else's. The reader's own data, but not that journal's to
 * be told.
 */
export async function getVotesFor(voterId: string, ref: string) {
  return scopeToJournal(await (await reactionRepo()).getVotesFor(voterId, ref), ref);
}

/**
 * Drops the votes that belong to another journal.
 *
 * Keys are `<username>/<trip-id>:<day-slug>`, so the journal is the part
 * before the first slash. A bare id predates multi-user and names no journal;
 * there is nothing to scope by, and returning it unchanged keeps the older
 * single-user store working.
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
