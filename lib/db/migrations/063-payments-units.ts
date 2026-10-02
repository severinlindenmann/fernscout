import type { MigrationDb } from "./types";

/**
 * `payments.credits` renamed to `units` — B2631.
 *
 * B2592–B2623 deleted the credit system itself (balance, ledger, the buy-
 * credits routes); this table is what is left of it, and only as the
 * operator's own bookkeeping record of what has already happened
 * (`lib/deletions.ts`'s `KEPT_MONEY_TABLES`, Swiss OR 958f — ten years). No
 * route anywhere still creates or settles a row (`createPayment`,
 * `submitRequest`, `createAdminGrant`, `claimApproval`, `claimProviderPayment`
 * and the rest were deleted alongside this migration, having had no caller
 * left since B2623), so the column can never again be fed a live "credits
 * bought" number — it only ever answers for a handful of already-settled
 * test rows. Renamed rather than dropped, because it is still part of the
 * bookkeeping fact ("how many of the old credit pack this purchase was for")
 * that a kept row must go on answering for.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("payments").renameColumn("credits", "units").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("payments").renameColumn("units", "credits").execute();
}
