import type { MigrationDb } from "./types";

/**
 * "Never invite this address again" — B2442. See lib/contacts/suppressions.ts
 * for what reads and writes it, and for why `hash` alone (no address, no
 * owner) is the whole row: this is instance-wide and the same
 * `recipientHash` the send log already keys on.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("invite_suppressions")
    .addColumn("hash", "text", (c) => c.primaryKey().notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("invite_suppressions").execute();
}
