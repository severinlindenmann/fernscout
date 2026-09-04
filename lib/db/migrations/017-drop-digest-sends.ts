import type { MigrationDb } from "./types";

/**
 * The weekly digest is gone, and so is its send record — B387.
 *
 * `digest_sends` was `004-digest`'s: one row per digest claimed and then
 * marked sent or failed, so a crash mid-run could not mail somebody twice.
 * Nothing writes it any more, because nothing sends a weekly digest any more.
 * The owner never scheduled one — there is no timer for it in `deploy/`, and
 * `runDigest` only ever fired when somebody typed `npm run digest` — so it was
 * a feature of the repository and never of the site.
 *
 * **Why the table goes rather than staying as a harmless empty one.** A table
 * no code explains is a question for whoever reads this schema next, and the
 * honest answer to "what writes this?" would have been "nothing, since
 * 2026-09". The owner chose to drop it. The rows recorded sends of a feature
 * that no longer exists, so nothing in them can be acted on.
 *
 * `004-digest.ts` is left exactly as it is. A migration that has run anywhere
 * is history and is never edited — the name is the primary key in
 * `kysely_migration`, and rewriting one would mean this database and a fresh
 * one disagree about what has happened to them. So the table is created there
 * and dropped here, and both statements stay true in order.
 *
 * `down` puts the structure back and cannot put the rows back. That is the
 * ordinary property of a drop and is stated here so nobody reads a reversible
 * migration as a reversible decision.
 */
export async function up(db: MigrationDb): Promise<void> {
  // The index first: SQLite drops it with the table, Postgres does too, but
  // being explicit keeps this readable beside `004`'s own `down`, which is
  // the thing a reader will compare it against.
  await db.schema.dropIndex("digest_sends_owner_contact").ifExists().execute();
  await db.schema.dropTable("digest_sends").ifExists().execute();
}

export async function down(db: MigrationDb): Promise<void> {
  // `004-digest`'s `up`, restated. Kept in step with it by hand, which is
  // acceptable for a table nothing writes: the only caller of this path is a
  // full `migrateDown`, and the shape it needs is the shape that existed when
  // the table was dropped.
  await db.schema
    .createTable("digest_sends")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("contact_id", "text", (c) =>
      c.notNull().references("contacts.id").onDelete("cascade"),
    )
    .addColumn("status", "text", (c) => c.notNull().defaultTo("sending"))
    .addColumn("cursor", "text", (c) => c.notNull())
    .addColumn("day_count", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("trips", "text", (c) => c.notNull().defaultTo("[]"))
    .addColumn("locale", "text")
    .addColumn("mail_ref", "text")
    .addColumn("error", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("sent_at", "text")
    .execute();

  await db.schema
    .createIndex("digest_sends_owner_contact")
    .on("digest_sends")
    .columns(["owner_id", "contact_id", "created_at"])
    .execute();
}
