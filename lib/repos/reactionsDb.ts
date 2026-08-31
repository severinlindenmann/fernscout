import type { DatabaseHandle } from "../db/client";
import { currentOwnerId, newId, nowIso } from "../db/owner";
import { isReaction, reactionKey, type Reaction, type ReactionCounts, type DayCounts } from "../reactionSet";
import type { ReactionRepo, VoteResult } from "./types";

/**
 * `count(*)` is `int8` on Postgres, which `pg` hands back as a string so it
 * can't silently lose precision; SQLite returns a number. Everything above
 * this layer gets a number either way.
 */
function toCount(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function collect(
  rows: readonly { trip_id: string; day_slug: string; emoji: string; n: unknown }[],
): ReactionCounts {
  const out: ReactionCounts = {};
  for (const row of rows) {
    if (!isReaction(row.emoji)) continue; // an emoji retired from REACTIONS
    const key = reactionKey(row.trip_id, row.day_slug);
    (out[key] ??= {})[row.emoji] = toCount(row.n);
  }
  return out;
}

/**
 * Reactions in the database.
 *
 * One row per vote, unique on (owner, trip, day, voter) — the same shape the
 * file store has, so the counts are still derived and still can't drift, and
 * the importer is a straight copy rather than a reinterpretation.
 */
export function dbReactionRepo(handle: DatabaseHandle): ReactionRepo {
  const { db } = handle;
  const owner = currentOwnerId();

  async function countsForDay(tripId: string, daySlug: string): Promise<DayCounts> {
    const rows = await db
      .selectFrom("reactions")
      .select(["trip_id", "day_slug", "emoji", (eb) => eb.fn.countAll().as("n")])
      .where("owner_id", "=", owner)
      .where("trip_id", "=", tripId)
      .where("day_slug", "=", daySlug)
      .groupBy(["trip_id", "day_slug", "emoji"])
      .execute();
    return collect(rows)[reactionKey(tripId, daySlug)] ?? {};
  }

  return {
    async getAllCounts(tripId) {
      const rows = await db
        .selectFrom("reactions")
        .select(["trip_id", "day_slug", "emoji", (eb) => eb.fn.countAll().as("n")])
        .where("owner_id", "=", owner)
        .where("trip_id", "=", tripId)
        .groupBy(["trip_id", "day_slug", "emoji"])
        .execute();
      return collect(rows);
    },

    async getVotesFor(voterId) {
      const rows = await db
        .selectFrom("reactions")
        .select(["trip_id", "day_slug", "emoji"])
        .where("owner_id", "=", owner)
        .where("voter_id", "=", voterId)
        .execute();
      const mine: Record<string, Reaction> = {};
      for (const row of rows) {
        if (isReaction(row.emoji)) mine[reactionKey(row.trip_id, row.day_slug)] = row.emoji;
      }
      return mine;
    },

    async vote(tripId, daySlug, voterId, emoji): Promise<VoteResult> {
      const existing = await db
        .selectFrom("reactions")
        .select(["id", "emoji"])
        .where("owner_id", "=", owner)
        .where("trip_id", "=", tripId)
        .where("day_slug", "=", daySlug)
        .where("voter_id", "=", voterId)
        .executeTakeFirst();

      let mine: Reaction | null;
      if (existing && existing.emoji === emoji) {
        // Picking what you already picked takes it back — the same gesture
        // every reaction UI uses, and it saves needing an "undo" affordance.
        await db.deleteFrom("reactions").where("id", "=", existing.id).execute();
        mine = null;
      } else {
        const now = nowIso();
        // Upsert rather than update-or-insert: two taps arriving together
        // would otherwise race through the read above and one would fail on
        // the unique index. `on conflict … do update` is portable across both
        // dialects; `merge` is not.
        await db
          .insertInto("reactions")
          .values({
            id: newId(),
            owner_id: owner,
            trip_id: tripId,
            day_slug: daySlug,
            voter_id: voterId,
            emoji,
            created_at: now,
            updated_at: now,
          })
          .onConflict((oc) =>
            oc
              .columns(["owner_id", "trip_id", "day_slug", "voter_id"])
              .doUpdateSet({ emoji, updated_at: now }),
          )
          .execute();
        mine = emoji;
      }

      return { counts: await countsForDay(tripId, daySlug), mine };
    },
  };
}
