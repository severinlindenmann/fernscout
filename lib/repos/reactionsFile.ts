import { readStore, updateStore } from "../store";
import { reactionKey, type Reaction, type ReactionCounts, type DayCounts } from "../reactionSet";
import { migrateKeys, type Votes } from "./votes";
import type { ReactionRepo, VoteResult } from "./types";

const FILE = "reactions";

const EMPTY: Votes = {};

export { migrateKeys, type Votes } from "./votes";

function countsFor(day: Record<string, Reaction> | undefined): DayCounts {
  const out: DayCounts = {};
  for (const emoji of Object.values(day ?? {})) {
    out[emoji] = (out[emoji] ?? 0) + 1;
  }
  return out;
}

/** Read the raw vote map with keys already scoped to a trip. */
export async function readVotes(currentTripId: string): Promise<Votes> {
  return migrateKeys(await readStore<Votes>(FILE, EMPTY), currentTripId);
}

/**
 * Reactions on the JSON file store.
 *
 * This is not a stopgap: it is the storage for the no-database deployment in
 * ROADMAP §2.2, and it stays supported. It does assume a single Node process,
 * because the write queue in `lib/store.ts` is per-process — which is the one
 * constraint the database backend removes.
 */
export function fileReactionRepo(): ReactionRepo {
  return {
    async getAllCounts(tripId) {
      const votes = await readVotes(tripId);
      const prefix = `${tripId}:`;
      const out: ReactionCounts = {};
      for (const [key, voters] of Object.entries(votes)) {
        if (!key.startsWith(prefix)) continue;
        const counts = countsFor(voters);
        // A day everyone un-reacted to leaves an empty object behind; the
        // database backend has no row for it at all, so drop it here too.
        if (Object.keys(counts).length > 0) out[key] = counts;
      }
      return out;
    },

    async getVotesFor(voterId, tripId) {
      const votes = await readVotes(tripId);
      const mine: Record<string, Reaction> = {};
      for (const [day, voters] of Object.entries(votes)) {
        if (voters[voterId]) mine[day] = voters[voterId];
      }
      return mine;
    },

    async vote(tripId, daySlug, voterId, emoji): Promise<VoteResult> {
      const key = reactionKey(tripId, daySlug);
      let mine: Reaction | null = null;
      const next = await updateStore<Votes>(FILE, EMPTY, (current) => {
        const migrated = migrateKeys(current, tripId);
        const day = { ...(migrated[key] ?? {}) };
        if (day[voterId] === emoji) {
          // Picking what you already picked takes it back — the same gesture
          // every reaction UI uses, and it saves needing an "undo" affordance.
          delete day[voterId];
          mine = null;
        } else {
          day[voterId] = emoji;
          mine = emoji;
        }
        return { ...migrated, [key]: day };
      });
      return { counts: countsFor(next[key]), mine };
    },
  };
}
