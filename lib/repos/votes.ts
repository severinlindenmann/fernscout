import { reactionKey, type Reaction } from "../reactionSet";

/**
 * The shape of `$DATA_DIR/reactions.json`: day key → voter id → emoji.
 *
 * Pure, with no filesystem and no `server-only`, so the one-shot JSON
 * importer can read it from a CLI as well as the request path.
 *
 * Storing the votes rather than a counter means the counts can always be
 * recomputed and can't drift, changing your mind is just an overwrite, and
 * taking it back is a delete. Voter ids are random strings the browser makes
 * up — there's nothing in here that identifies a person.
 */
export type Votes = Record<string, Record<string, Reaction>>;

/**
 * Votes recorded before the site had trips are keyed by bare day slug. They
 * all belong to whichever trip was running at the time, which is the current
 * one — so prefix them rather than lose them. Runs on every read; once every
 * key is scoped it is a cheap no-op.
 *
 * Two passes, not one, so the merge direction is explicit rather than
 * riding on `Object.entries` iteration order: bare keys go in first, then
 * already-scoped keys are layered on top and win on conflict, because a
 * scoped key was written after the migration and is therefore the more
 * recent expression of that reader's choice.
 */
export function migrateKeys(votes: Votes, currentTripId: string): Votes {
  if (!Object.keys(votes).some((k) => !k.includes(":"))) return votes;
  const out: Votes = {};
  for (const [key, voters] of Object.entries(votes)) {
    if (key.includes(":")) continue;
    const scoped = reactionKey(currentTripId, key);
    out[scoped] = { ...(out[scoped] ?? {}), ...voters };
  }
  for (const [key, voters] of Object.entries(votes)) {
    if (!key.includes(":")) continue;
    out[key] = { ...(out[key] ?? {}), ...voters };
  }
  return out;
}

/** Split a `trip:day` key. Keys without a colon have already been through
 * `migrateKeys`, so this only meets scoped ones — but it copes anyway rather
 * than dropping a row on the floor during an import. */
export function splitKey(
  key: string,
  fallbackTripId: string,
): { tripId: string; daySlug: string } {
  const i = key.indexOf(":");
  if (i < 0) return { tripId: fallbackTripId, daySlug: key };
  return { tripId: key.slice(0, i), daySlug: key.slice(i + 1) };
}
