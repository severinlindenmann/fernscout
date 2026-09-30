import type { MigrationDb } from "./types";

/**
 * Two columns a subscription (not a one-off pass) needs — B2593.
 *
 * `cancel_at_period_end`: set by the `customer.subscription.updated` webhook
 * when the owner cancels in the Customer Portal. The entitlement's own
 * `status`/`ends_at` stay `active`/the paid period's end either way — a
 * cancelled Plus runs until its paid period ends, per docs/billing.md — this
 * is read-only context for the account page ("renews" vs "ends") rather than
 * something `planOf()` branches on.
 *
 * `upgrade_promo_id`: the single-use Stripe promotion code minted when a pass
 * is granted, bound to that one purchase, so the Plus checkout can offer the
 * CHF 19 upgrade coupon within the 60-day window and never redeem it twice.
 * Null on every plan that never had one (Plus itself, an admin grant, a pass
 * bought before this migration).
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .alterTable("entitlements")
    .addColumn("cancel_at_period_end", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable("entitlements").addColumn("upgrade_promo_id", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("entitlements").dropColumn("upgrade_promo_id").execute();
  await db.schema.alterTable("entitlements").dropColumn("cancel_at_period_end").execute();
}
