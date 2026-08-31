import type { MigrationDb } from "./types";

/**
 * One row per digest, per reader — the thing that makes re-running safe.
 *
 * The digest is the primary notification channel (decision 6), which means the
 * sender runs unattended on a cron and will, eventually, die halfway through a
 * list of fifty people. The failure to design against is therefore not "the
 * mail did not go" but "the mail went twice", because the second one arrives in
 * the inbox of somebody who did not ask to be pestered and reaches for "mark as
 * spam" — and that costs the sender every future digest, to everyone.
 *
 * So the unit of record is the *send*, not a `last_digest_at` column on
 * `contacts`. A column would answer "when", and nothing else: it could not say
 * how far the last digest read, could not tell an attempt that crashed from one
 * that was never made, and could not be inspected after the fact when a reader
 * says they got two. A row can, and costs one insert per person per week.
 *
 * ## The three columns that carry the design
 *
 * - **`cursor`** is the high-water mark: the date of the newest day that went
 *   into that mail. The next run asks for days *after* it, so idempotency is a
 *   property of the data rather than of a lock — a second run computes an empty
 *   list and sends nothing, which is also exactly what makes `--dry-run`
 *   trustworthy.
 * - **`status`** is `sending` before the transport is called and `sent` after.
 *   A row stuck at `sending` is an attempt whose outcome nobody knows, and it
 *   counts as delivered on the next run: a missed week is a smaller harm than a
 *   duplicate. `failed` is the known-negative case — the transport threw, the
 *   reader got nothing — and does not block a retry.
 * - **`created_at`** is when the attempt began, in UTC, and is what the
 *   quiet rules read (D8: never more than one a day). `sent_at` is when it
 *   actually left, which is a different question and occasionally a different
 *   day.
 *
 * `trips` is a JSON summary of what went out, as text like everything else in
 * this schema. It is for the human reading the table six months later; nothing
 * branches on it.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("digest_sends")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    // Cascades: deleting a contact (the GDPR path) must not leave a record of
    // what was mailed to them behind.
    .addColumn("contact_id", "text", (c) =>
      c.notNull().references("contacts.id").onDelete("cascade"),
    )
    .addColumn("status", "text", (c) => c.notNull().defaultTo("sending"))
    // The newest day date this digest covered, `YYYY-MM-DD`. Everything at or
    // before it has been reported to this reader.
    .addColumn("cursor", "text", (c) => c.notNull())
    .addColumn("day_count", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("trips", "text", (c) => c.notNull().defaultTo("[]"))
    // Which language it was written in — the one field that makes a wrong
    // guess visible without opening the .eml.
    .addColumn("locale", "text")
    // The file path or message id the transport gave back.
    .addColumn("mail_ref", "text")
    .addColumn("error", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("sent_at", "text")
    .execute();

  // Every question this table is asked is "the latest for this person".
  await db.schema
    .createIndex("digest_sends_owner_contact")
    .on("digest_sends")
    .columns(["owner_id", "contact_id", "created_at"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("digest_sends_owner_contact").execute();
  await db.schema.dropTable("digest_sends").execute();
}
