import type { MigrationDb } from "./types";

/**
 * Reader groups — TIX-6. An owner's own labels for the people who read along
 * ("Family", "Friends"), one per person, so a new day can be told to some of
 * them rather than all. **A label, never a grant**: reading stays journal-wide
 * (`access_grants`, B35/B41), and nothing here is ever shown to the reader.
 *
 * - `reader_groups` — the owner's list, at most `GROUP_LIMIT` of them.
 * - `contacts.group_id` — the one group this person is in, or null.
 * - `contacts.asked_group_id` — a link offered another group to somebody who
 *   is already in one; held here until the owner chooses Keep or Move, because
 *   a forwarded link must not re-sort anybody by itself.
 * - `contact_invites.group_id` — where people who join through this link go.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("reader_groups")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("color", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("sort", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("reader_groups_owner").on("reader_groups").column("owner_id").execute();
  await db.schema.alterTable("contacts").addColumn("group_id", "text").execute();
  await db.schema.alterTable("contacts").addColumn("asked_group_id", "text").execute();
  await db.schema.alterTable("contact_invites").addColumn("group_id", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contact_invites").dropColumn("group_id").execute();
  await db.schema.alterTable("contacts").dropColumn("asked_group_id").execute();
  await db.schema.alterTable("contacts").dropColumn("group_id").execute();
  await db.schema.dropIndex("reader_groups_owner").execute();
  await db.schema.dropTable("reader_groups").execute();
}
