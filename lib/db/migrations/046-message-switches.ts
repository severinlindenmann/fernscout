import type { MigrationDb } from "./types";

/**
 * The operator's per-message-kind kill switch — B2446. `key` is a flow id, a
 * `flow/template` pair, or a bare template id (`lib/messages/switches.ts`
 * decides which). **A row's existence is the whole state**: present means
 * off, deleted means on again — there is no boolean column to disagree with
 * the row being there, and turning a switch back on is one `DELETE`. No
 * database ⇒ no switches at all — capabilities decide, as before B2446.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("message_switches")
    .addColumn("key", "text", (c) => c.primaryKey().notNull())
    .addColumn("updated_by", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("message_switches").execute();
}
