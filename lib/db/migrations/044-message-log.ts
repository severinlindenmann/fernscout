import type { MigrationDb } from "./types";

/**
 * The send log every channel writes to — B2438. See lib/messages/log.ts for
 * what writes it and lib/messages/registry.ts for the `template` ids it
 * carries. No bodies, ever, and no address: `recipient_hash`/`recipient_mask`
 * are the only trace of who a message went to.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("message_log")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    // NO_JOURNAL ("*") when the message belongs to no journal yet — a
    // signup code, an operator alert. Same convention as sms_messages.
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("template", "text", (c) => c.notNull())
    .addColumn("channel", "text", (c) => c.notNull())
    .addColumn("flow", "text")
    .addColumn("recipient_hash", "text", (c) => c.notNull())
    .addColumn("recipient_mask", "text", (c) => c.notNull())
    .addColumn("locale", "text")
    // sent | skipped | failed | held | test — closed list in lib/messages/log.ts.
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("reason", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  // The two questions admin (a later ticket) and the sweep ask: what went out
  // recently, and everything to one person.
  await db.schema.createIndex("message_log_created").on("message_log").columns(["created_at"]).execute();
  await db.schema.createIndex("message_log_recipient").on("message_log").columns(["recipient_hash"]).execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("message_log_recipient").execute();
  await db.schema.dropIndex("message_log_created").execute();
  await db.schema.dropTable("message_log").execute();
}
