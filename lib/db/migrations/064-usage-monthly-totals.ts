import type { MigrationDb } from "./types";

/**
 * Where a `usage` row goes once it is older than the retention window —
 * B2605. One row per `(owner_id, month, provider)`; `foldUsageOlderThan`
 * (lib/usage.ts) adds into it and then deletes the rows it summed, so a
 * month that finishes aging out over several nights accumulates here rather
 * than losing everything but the last night's slice.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("usage_monthly_totals")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("month", "text", (c) => c.notNull())
    .addColumn("provider", "text", (c) => c.notNull())
    .addColumn("cost_rappen", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("calls", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("usage_monthly_totals_unique")
    .on("usage_monthly_totals")
    .columns(["owner_id", "month", "provider"])
    .unique()
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("usage_monthly_totals").execute();
}
