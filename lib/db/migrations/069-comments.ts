import type { MigrationDb } from "./types";

/**
 * Comments under a published day — B-2957.
 *
 * One row per comment. `owner_id` is the journal's username and `trip_id` the
 * `<username>/<trip>` ref, like the push subscriptions. `author_email` exists
 * only so the server can tell whose comment it is; it is never sent to a
 * client. `author_name` is the display name at the time of posting.
 *
 * Plain text timestamps and no foreign keys, like every table here, so the
 * same statements run on SQLite and Postgres.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("comments")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("trip_id", "text", (c) => c.notNull())
    .addColumn("day_slug", "text", (c) => c.notNull())
    .addColumn("author_email", "text", (c) => c.notNull())
    .addColumn("author_name", "text", (c) => c.notNull())
    .addColumn("body", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("edited_at", "text")
    .execute();

  await db.schema
    .createIndex("comments_by_day")
    .on("comments")
    .columns(["owner_id", "trip_id", "day_slug", "created_at"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("comments").execute();
}
