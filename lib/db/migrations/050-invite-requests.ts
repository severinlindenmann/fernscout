import type { MigrationDb } from "./types";

/**
 * A stranger asking to be invited — B2507. See `schema.ts`'s
 * `InviteRequestsTable` for the reasoning; this is its table, the same
 * shape as `043-app-waitlist`.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("invite_requests")
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.primaryKey().notNull())
    .addColumn("locale", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("invite_requests").execute();
}
