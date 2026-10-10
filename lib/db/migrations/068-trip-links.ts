import type { MigrationDb } from "./types";

/**
 * Trip links — B2961 (epic B2960).
 *
 * - `contact_invites.read_code_hash` / `read_code_cipher` — the 16-character
 *   code of a `read` link (`/t/<code>`). Its own columns, not the join
 *   code's: `joinCodeFor` mints and decrypts for any invite it is handed.
 * - `contact_invites.last_used_at` — when the link was last opened.
 * - `trip_link_keeps` — one row per link per person who kept the trip
 *   (the keep child fills it). `trip_id` makes rename and delete sweep it
 *   with every other table; the unique key lets two links give two rows.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contact_invites").addColumn("read_code_hash", "text").execute();
  await db.schema.alterTable("contact_invites").addColumn("read_code_cipher", "text").execute();
  await db.schema.alterTable("contact_invites").addColumn("last_used_at", "text").execute();
  await db.schema
    .createIndex("contact_invites_read_code_hash_unique")
    .on("contact_invites")
    .column("read_code_hash")
    .unique()
    .execute();

  await db.schema
    .createTable("trip_link_keeps")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("trip_id", "text", (c) => c.notNull())
    .addColumn("invite_id", "text", (c) => c.notNull())
    .addColumn("contact_id", "text", (c) => c.notNull())
    .addColumn("kept_at", "text", (c) => c.notNull())
    .addColumn("revoked_at", "text")
    .addUniqueConstraint("trip_link_keeps_unique", ["owner_id", "invite_id", "contact_id"])
    .execute();
  await db.schema.createIndex("trip_link_keeps_trip").on("trip_link_keeps").columns(["owner_id", "trip_id"]).execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("trip_link_keeps").execute();
  await db.schema.dropIndex("contact_invites_read_code_hash_unique").execute();
  await db.schema.alterTable("contact_invites").dropColumn("last_used_at").execute();
  await db.schema.alterTable("contact_invites").dropColumn("read_code_cipher").execute();
  await db.schema.alterTable("contact_invites").dropColumn("read_code_hash").execute();
}
