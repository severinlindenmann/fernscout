import type { DatabaseHandle } from "../db/client";
import { newId, nowIso } from "../db/owner";
import type { CommentRepo, StoredComment } from "./types";

/** `<username>/<trip>` → the username, which is the row's `owner_id`. */
const ownerOf = (tripId: string) => tripId.split("/")[0];

function toComment(row: {
  id: string;
  trip_id: string;
  day_slug: string;
  author_email: string;
  author_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
}): StoredComment {
  return {
    id: row.id,
    tripId: row.trip_id,
    daySlug: row.day_slug,
    authorEmail: row.author_email,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

/** Comments in the database. */
export function dbCommentRepo(handle: DatabaseHandle): CommentRepo {
  const { db } = handle;

  const one = (tripId: string, daySlug: string, id: string) =>
    db
      .selectFrom("comments")
      .selectAll()
      .where("owner_id", "=", ownerOf(tripId))
      .where("trip_id", "=", tripId)
      .where("day_slug", "=", daySlug)
      .where("id", "=", id);

  return {
    async list(tripId, daySlug, limit) {
      const base = () =>
        db
          .selectFrom("comments")
          .where("owner_id", "=", ownerOf(tripId))
          .where("trip_id", "=", tripId)
          .where("day_slug", "=", daySlug);
      const [counted, rows] = await Promise.all([
        base().select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
        (limit === undefined
          ? base().selectAll().orderBy("created_at").orderBy("id")
          : base().selectAll().orderBy("created_at", "desc").orderBy("id", "desc").limit(limit)
        ).execute(),
      ]);
      if (limit !== undefined) rows.reverse();
      // `count(*)` is int8 on Postgres, which `pg` returns as a string.
      return { comments: rows.map(toComment), total: Number(counted.n) };
    },

    async get(tripId, daySlug, id) {
      const row = await one(tripId, daySlug, id).executeTakeFirst();
      return row ? toComment(row) : null;
    },

    async add(comment) {
      const stored: StoredComment = { ...comment, id: newId(), editedAt: null };
      await db
        .insertInto("comments")
        .values({
          id: stored.id,
          owner_id: ownerOf(stored.tripId),
          trip_id: stored.tripId,
          day_slug: stored.daySlug,
          author_email: stored.authorEmail,
          author_name: stored.authorName,
          body: stored.body,
          created_at: stored.createdAt,
          edited_at: null,
        })
        .execute();
      return stored;
    },

    async update(tripId, daySlug, id, body) {
      await db
        .updateTable("comments")
        .set({ body, edited_at: nowIso() })
        .where("owner_id", "=", ownerOf(tripId))
        .where("trip_id", "=", tripId)
        .where("day_slug", "=", daySlug)
        .where("id", "=", id)
        .execute();
      const row = await one(tripId, daySlug, id).executeTakeFirst();
      return row ? toComment(row) : null;
    },

    async remove(tripId, daySlug, id) {
      const result = await db
        .deleteFrom("comments")
        .where("owner_id", "=", ownerOf(tripId))
        .where("trip_id", "=", tripId)
        .where("day_slug", "=", daySlug)
        .where("id", "=", id)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    async removeForTrip(tripId) {
      await db.deleteFrom("comments").where("owner_id", "=", ownerOf(tripId)).where("trip_id", "=", tripId).execute();
    },

    async moveForTrip(oldRef, newRef) {
      await db.updateTable("comments").set({ trip_id: newRef }).where("owner_id", "=", ownerOf(oldRef)).where("trip_id", "=", oldRef).execute();
    },

    async removeByAuthor(owner, authorEmail) {
      await db.deleteFrom("comments").where("owner_id", "=", owner).where("author_email", "=", authorEmail).execute();
    },

    async countByAuthorSince(tripId, authorEmail, sinceIso) {
      const row = await db
        .selectFrom("comments")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("owner_id", "=", ownerOf(tripId))
        .where("trip_id", "=", tripId)
        .where("author_email", "=", authorEmail)
        .where("created_at", ">=", sinceIso)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },
  };
}
