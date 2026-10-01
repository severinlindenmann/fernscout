import type { MigrationDb } from "./types";

/**
 * How many of a plan's included prints an owner has already claimed, in the
 * plan period the row is keyed on — B2594/B2595.
 *
 * One row per `(owner_id, period_key)`, `used` counted up by a conditional
 * UPDATE keyed on its own current value (the same compare-and-set shape
 * `paid/postcard/lib/postcard/orders.ts`'s `refreshProviderStatuses` already
 * uses for a JSON column) rather than a read followed by a write — two
 * postcard orders reserved in the same instant cannot both read "one left"
 * and both claim it. `period_key` is the caller's own string (a pass's
 * `plan.periodStart`, or a photobook order has none) so this table knows
 * nothing about what it is counting; `paid/billing/lib/print-usage.ts` is the
 * one place that decides what a period is.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("print_included_usage")
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("period_key", "text", (c) => c.notNull())
    .addColumn("used", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex("print_included_usage_unique")
    .on("print_included_usage")
    .columns(["owner_id", "period_key"])
    .unique()
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("print_included_usage").execute();
}
