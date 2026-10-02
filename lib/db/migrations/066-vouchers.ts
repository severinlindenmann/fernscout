import type { MigrationDb } from "./types";

/**
 * A fixed-amount discount off one print — B2726.
 *
 * General by design: the app-upgrade photobook voucher (a Trip pass holder
 * who subscribes to Plus in the app, since Apple allows no subscriber
 * discount there — 3.1.1/3.1.3(e)) is only the first issuer. `owner_id` is
 * null until a coded voucher (a future promotion) is claimed; `code` is null
 * for every voucher issued straight to an owner, like this one. `source_ref`
 * is the issuing event's own id (an Apple transaction, a promotion batch) —
 * unique together with `source` so a replayed grant never issues twice, the
 * same guard `054-entitlements` gives `provider_ref`. One row is one use:
 * `used_at`/`used_ref` are set together, once, by a single conditional
 * UPDATE (`markVoucherUsed`), never by a plain read-then-write.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("vouchers")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text")
    .addColumn("code", "text")
    .addColumn("applies_to", "text", (c) => c.notNull())
    .addColumn("amount_rappen", "integer", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("source_ref", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("expires_at", "text")
    .addColumn("used_at", "text")
    .addColumn("used_ref", "text")
    .execute();

  await db.schema.createIndex("vouchers_owner").on("vouchers").columns(["owner_id", "used_at"]).execute();

  await db.schema.createIndex("vouchers_code_unique").on("vouchers").column("code").unique().execute();

  // SQLite and Postgres both treat every NULL as distinct under a unique
  // index, so a promotion batch's own vouchers (code set, source_ref null)
  // are unaffected — only a real, non-null (source, source_ref) pair is ever
  // forced unique, the same shape `054-entitlements` gives `provider_ref`.
  await db.schema
    .createIndex("vouchers_source_ref_unique")
    .on("vouchers")
    .columns(["source", "source_ref"])
    .unique()
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("vouchers").execute();
}
