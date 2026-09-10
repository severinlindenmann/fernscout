import type { MigrationDb } from "./types";

/**
 * Every outbound WhatsApp message, one row per recipient — B1347.
 *
 * `day_notifications` cannot answer the operator's money question: it holds
 * one row per (owner, trip, slug, channel) however many recipients the
 * announcement went to, and reminders, one-time codes and free-form replies
 * never touch it at all. Meta bills per conversation, by category, so the
 * row carries the category the message was sent under; the closed list is
 * WHATSAPP_CATEGORIES in lib/whatsapp/sends.ts, text like every other
 * status column in this schema.
 *
 * `owner_id` is the journal the send was on behalf of, or NO_JOURNAL ("*")
 * when there is none yet — a signup code, a stranger reply — the same
 * convention 031 set for the SMS log.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("whatsapp_sends")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("category", "text", (c) => c.notNull())
    .addColumn("template", "text", (c) => c.notNull())
    .addColumn("sent_at", "text", (c) => c.notNull())
    .execute();

  // The only question this table is asked: sends since a date, by category.
  await db.schema.createIndex("whatsapp_sends_sent").on("whatsapp_sends").columns(["sent_at"]).execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("whatsapp_sends_sent").execute();
  await db.schema.dropTable("whatsapp_sends").execute();
}
