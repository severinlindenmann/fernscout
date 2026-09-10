import type { MigrationDb } from "./types";

/**
 * Every SMS this instance has exchanged — B1316.
 *
 * One table for both directions rather than an inbox and an outbox: the
 * operator's question on /admin is "what happened on this number", and the
 * answer is one conversation-shaped list. `direction` is text like every
 * other status column in this schema (Postgres wants `create type` for an
 * enum, SQLite has none); the closed list is in lib/sms/store.ts.
 *
 * `provider_sid` is Twilio's own message id, and its UNIQUE constraint is
 * the inbound dedupe: Twilio retries a webhook it got no 200 for, the sid is
 * stable across the retry, and a second insert simply does not happen — a
 * DB constraint where lib/idempotency.ts would be a second mechanism saying
 * the same thing. Null for a dry-run send, which has no provider to name.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("sms_messages")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    // Always NO_JOURNAL ("*"): the number is the instance's, so no journal's
    // deletion sweeps these rows — the column exists because ROADMAP §0.5
    // demands every table say whose its rows are, and these are nobody's.
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("direction", "text", (c) => c.notNull())
    .addColumn("from_e164", "text", (c) => c.notNull())
    .addColumn("to_e164", "text", (c) => c.notNull())
    .addColumn("body", "text", (c) => c.notNull())
    .addColumn("provider_sid", "text", (c) => c.unique())
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  // The only question this table is asked: the latest messages, newest first.
  await db.schema.createIndex("sms_messages_created").on("sms_messages").columns(["created_at"]).execute();

  // With two ways to prove one number (WhatsApp tap, SMS code) the session
  // has to say which actually happened, or `owner.telProvenMethod` would be
  // guessed from the configured mode — a false statement whenever the
  // fallback was the path taken. Written by markPhoneProven beside
  // `phone`/`phone_proven_at` (028); null on every earlier row, which reads
  // as "the configured mode", the only honest answer available for them.
  await db.schema.alterTable("sessions").addColumn("phone_proven_method", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("sessions").dropColumn("phone_proven_method").execute();
  await db.schema.dropIndex("sms_messages_created").execute();
  await db.schema.dropTable("sms_messages").execute();
}
