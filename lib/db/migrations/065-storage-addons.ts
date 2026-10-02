import type { MigrationDb } from "./types";

/**
 * The Plus +10 GB storage add-on — B2629.
 *
 * Its own table rather than a row on `entitlements`: a plan row's `plan`
 * column is only ever `"pass" | "plus"` and `planOf()`'s rank logic picks
 * the single best row for an owner, which the add-on (bought alongside
 * Plus, never instead of it) must never compete with. One row per Stripe
 * subscription (`provider_ref`, unique when present — the same "one payment,
 * one grant" guard `054-entitlements` gives the plan table), `status` moving
 * `active` -> `ended`/`refunded` the same way, and no `period_start`/
 * `period_end`: the add-on gates nothing AI-day-shaped, only
 * `lib/storageQuota.ts`'s `purchasedBytes`, which only needs "is there a
 * live row for this owner right now".
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("storage_addons")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("provider_ref", "text")
    .addColumn("starts_at", "text", (c) => c.notNull())
    .addColumn("ends_at", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("cancel_at_period_end", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  await db.schema.createIndex("storage_addons_owner").on("storage_addons").columns(["owner_id", "status"]).execute();

  await db.schema
    .createIndex("storage_addons_provider_ref_unique")
    .on("storage_addons")
    .column("provider_ref")
    .unique()
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("storage_addons").execute();
}
