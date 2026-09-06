import type { MigrationDb } from "./types";

/**
 * One row: this channel has already told readers about this day — B633.
 *
 * `sendDayLetter` and `sendDayWhatsapp` (`lib/digest/`) could always be
 * called again for the same day — a resend is deliberate and the API routes
 * that expose it say `resend: true` on purpose (B345, B365). What was missing
 * was the *other* question: has this day been announced at all, so the
 * owner's own page can offer a button once and then stop offering it.
 *
 * **Why not read this off `credit_ledger`.** A send with only the owner's own
 * free copy as a recipient (B614) charges zero credits and therefore writes
 * no ledger row at all — `spend(owner, 0, …)` is a no-op by design. A journal
 * with no other readers yet would then look permanently "never sent" no
 * matter how many times the button was pressed. This table is written by
 * `sendDayLetter` / `sendDayWhatsapp` themselves, on every `ok: true`
 * outcome, whatever it cost — so it is right exactly where the ledger
 * cannot be.
 *
 * `sent_at` is overwritten rather than a second row inserted: a resend is
 * still one fact about a day and a channel — "has it gone out" — not a log of
 * every time it has. `credit_ledger` already is that log, for the cost side.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("day_notifications")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("trip_id", "text", (c) => c.notNull())
    .addColumn("slug", "text", (c) => c.notNull())
    // "mail" | "whatsapp".
    .addColumn("channel", "text", (c) => c.notNull())
    .addColumn("sent_at", "text", (c) => c.notNull())
    .execute();

  // The only question this table is ever asked: which channels has this one
  // day, in this one trip, already gone out on.
  await db.schema
    .createIndex("day_notifications_day")
    .on("day_notifications")
    .columns(["owner_id", "trip_id", "slug", "channel"])
    .unique()
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("day_notifications_day").execute();
  await db.schema.dropTable("day_notifications").execute();
}
