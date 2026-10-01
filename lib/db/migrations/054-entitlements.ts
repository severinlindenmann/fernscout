import type { MigrationDb } from "./types";

/**
 * Which plan a journal has, if any — B2590.
 *
 * Free is the absence of a row, exactly like a journal nobody granted
 * credits to has no `payments` row either. A row here records one purchase
 * or admin grant of `pass` or `plus`: `provider_ref` is the Stripe
 * checkout/invoice/subscription id or the Apple transaction id that paid for
 * it, unique when present, so one payment can never produce two rows —
 * `null` on an admin grant, which is not a payment. `status` moves from
 * `active` to `grace` (a failed Plus renewal, 7 days) to `ended` or
 * `refunded`; an older event never overwrites a newer state, because every
 * write here is a single conditional UPDATE keyed on the current status
 * (the `claimProviderPayment` pattern, `paid/billing/lib/payments.ts`).
 *
 * `period_start`/`period_end` are the AI-day counting window: for a Trip
 * pass, the same 45 days as `starts_at`/`ends_at`; for Plus, the current
 * subscription year, which moves forward on renewal while `ends_at` only
 * moves on cancellation or lapse.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("entitlements")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("plan", "text", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("provider_ref", "text")
    .addColumn("starts_at", "text", (c) => c.notNull())
    .addColumn("ends_at", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("period_start", "text", (c) => c.notNull())
    .addColumn("period_end", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("entitlements_owner")
    .on("entitlements")
    .columns(["owner_id", "status"])
    .execute();

  // Multiple admin grants share a null provider_ref; SQLite and Postgres
  // both treat NULLs as distinct under a unique index, so only a real,
  // non-null provider reference is ever forced unique — B366's
  // "one payment never makes two plans" rule, mechanised the same way
  // `payments.provider_ref` is not (that table has no such guard yet; this
  // one needs it from the start because a plan, unlike a credit top-up, is
  // never merely additive).
  await db.schema
    .createIndex("entitlements_provider_ref_unique")
    .on("entitlements")
    .column("provider_ref")
    .unique()
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("entitlements").execute();
}
