import type { MigrationDb } from "./types";

/**
 * Snoozing an entry of `/admin`'s attention band.
 *
 * `until` is the moment a snooze stops holding, ISO like every other stamp in
 * this schema. Null on every row written before this column and on every
 * plain acknowledgement, which keeps its old meaning exactly: it holds for as
 * long as the entry does not get worse. A snooze is the same row with a time
 * limit — it still lapses on the entry getting worse, and it also lapses on
 * the clock, which is the whole difference between "I know" and "not today".
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("admin_acks").addColumn("until", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("admin_acks").dropColumn("until").execute();
}
