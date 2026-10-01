import type { MigrationDb } from "./types";

/**
 * Who the owner told last time, per trip — TIX-6 phase 2. The studio's
 * publish step offers the same reader groups again (and whether to email them
 * too) for the next day of that trip, so the usual audience is one tap.
 *
 * `groups` is a JSON array of group ids, plus `"none"` for readers in no
 * group, or null for everyone. A remembered choice, never a permission:
 * publishing still asks, and who may read the day is decided elsewhere.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("tell_choices")
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("trip_id", "text", (c) => c.notNull())
    .addColumn("groups", "text")
    .addColumn("mail", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addPrimaryKeyConstraint("tell_choices_pk", ["owner_id", "trip_id"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("tell_choices").execute();
}
