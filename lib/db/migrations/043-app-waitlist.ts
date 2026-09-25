import type { MigrationDb } from "./types";

/**
 * The iPhone app's waitlist — B2341. See `schema.ts`'s `AppWaitlistTable`
 * for the reasoning; this is its table, the same shape as `035-signup-invites`.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("app_waitlist")
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.primaryKey().notNull())
    .addColumn("locale", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("app_waitlist").execute();
}
