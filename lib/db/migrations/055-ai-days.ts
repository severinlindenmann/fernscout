import type { MigrationDb } from "./types";

/**
 * Which trip dates an owner has already used an AI day on — B2591.
 *
 * Taken by the first draft, polish or photo description on a date; further
 * AI work on that same date takes nothing more, which is exactly what the
 * unique `(owner_id, trip_id, date)` constraint gives for free — a second
 * insert for the same date fails, and the caller reads that as "already
 * counted" rather than trying to detect it itself. `plan_period_start` is
 * recorded so a later `planOf()` reading — a renewed Plus year, say — can
 * tell which subscription period a day was taken in without recomputing it
 * from the entitlement's own history.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("ai_days")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("trip_id", "text", (c) => c.notNull())
    .addColumn("date", "text", (c) => c.notNull())
    .addColumn("first_used_at", "text", (c) => c.notNull())
    .addColumn("plan_period_start", "text")
    .execute();

  await db.schema
    .createIndex("ai_days_unique")
    .on("ai_days")
    .columns(["owner_id", "trip_id", "date"])
    .unique()
    .execute();

  await db.schema.createIndex("ai_days_owner").on("ai_days").column("owner_id").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("ai_days").execute();
}
