import type { MigrationDb } from "./types";

/**
 * The welcome guide and the short join link — B2293 (B2291 "Links",
 * "What the person sees").
 *
 * - `contacts.onboarded_at` — when the person finished the six-screen guide at
 *   `/w/<code>`. Set once; a later visit goes straight to the journal.
 * - `contact_invites.join_code_hash` / `join_code_cipher` — the group link's
 *   `/j/<code>`: a sha-256 for lookup (unique across the instance, since `/j/`
 *   names no journal) and an AES-256-GCM copy so the owner can show it again —
 *   the shape `040-welcome-links` gave the welcome code. The code grants
 *   nothing: whoever opens it proves an email or a number and becomes a
 *   request the owner answers.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contacts").addColumn("onboarded_at", "text").execute();
  await db.schema.alterTable("contact_invites").addColumn("join_code_hash", "text").execute();
  await db.schema.alterTable("contact_invites").addColumn("join_code_cipher", "text").execute();
  await db.schema
    .createIndex("contact_invites_join_code_hash_unique")
    .on("contact_invites")
    .column("join_code_hash")
    .unique()
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("contact_invites_join_code_hash_unique").execute();
  await db.schema.alterTable("contact_invites").dropColumn("join_code_cipher").execute();
  await db.schema.alterTable("contact_invites").dropColumn("join_code_hash").execute();
  await db.schema.alterTable("contacts").dropColumn("onboarded_at").execute();
}
