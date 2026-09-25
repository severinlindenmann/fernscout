import type { MigrationDb } from "./types";

/**
 * Where a photobook arrangement lives between visits — B1981.
 *
 * One row per journal per trip, holding the `BookOptions` JSON the composer
 * would otherwise have kept only in one browser's `localStorage`. See the
 * table's comment in `lib/db/schema.ts` for why it stopped being enough.
 *
 * The primary key is the pair, so saving is an upsert and a second device
 * cannot create a second draft for the same trip. No foreign key to anything:
 * the trip is a folder on disk, not a row, and `lib/deletions.ts` already
 * sweeps every table carrying `owner_id` and `trip_id` when either goes.
 *
 * Nothing here is a credential and nothing here is money: it is the same
 * arrangement the owner's own browser has been holding all along.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("photobook_drafts")
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("trip_id", "text", (c) => c.notNull())
    .addColumn("options", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addPrimaryKeyConstraint("photobook_drafts_pk", ["owner_id", "trip_id"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("photobook_drafts").execute();
}
