import type { MigrationDb } from "./types";

/**
 * The credit system is gone, and so are its two tables — B2592.
 *
 * `credits` (one row per journal, `016-credits.ts`) and `credit_ledger`
 * (`016-credits.ts`, moved to hundredths by `027-credits-hundredths.ts`) are
 * what `lib/credits.ts` kept a balance and its audit trail in. The billing
 * run (B2589–B2599) replaced charging a journal per send with a plan
 * (`entitlements`, `ai_days`) that owners pay for once at checkout, through
 * Stripe or Apple, never per message — see `docs/billing.md`. Nothing has
 * written either table since, and there are no customers yet to migrate: the
 * owner's own decision for this run is that nothing is converted, a balance
 * is simply deleted along with the system that spent it.
 *
 * `016-credits.ts` and `027-credits-hundredths.ts` are left exactly as they
 * are — a migration that has run anywhere is history, and the name is the
 * primary key in `kysely_migration`. The tables are created there and
 * dropped here.
 *
 * `down` puts the structure back (in hundredths, matching what `up` in
 * `027-credits-hundredths.ts` left behind) and cannot put the rows back.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("credit_ledger_owner").ifExists().execute();
  await db.schema.dropTable("credit_ledger").ifExists().execute();
  await db.schema.dropTable("credits").ifExists().execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("credits")
    .addColumn("owner_id", "text", (c) => c.primaryKey().notNull())
    .addColumn("balance", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("credit_ledger")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("delta", "integer", (c) => c.notNull())
    .addColumn("reason", "text", (c) => c.notNull())
    .addColumn("ref", "text")
    .addColumn("note", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("credit_ledger_owner")
    .on("credit_ledger")
    .columns(["owner_id", "created_at"])
    .execute();
}
