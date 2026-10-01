import type { MigrationDb } from "./types";

/**
 * The dedupe marks for B2608's three date-triggered plan emails — the
 * renewal reminder 30 days before Plus renews, "pass ends in 5 days" and
 * "pass ended". One column per email: a timestamp for the two one-shot pass
 * emails, and the `period_end` the renewal reminder was last sent for
 * (compared against the *current* `period_end` rather than a plain
 * timestamp, since a Plus subscription's `period_end` moves forward on every
 * renewal while `period_start` never does — the same reminder must fire
 * again next year).
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("entitlements").addColumn("renewal_reminder_period_end", "text").execute();
  await db.schema.alterTable("entitlements").addColumn("pass_ending_sent_at", "text").execute();
  await db.schema.alterTable("entitlements").addColumn("pass_ended_sent_at", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("entitlements").dropColumn("pass_ended_sent_at").execute();
  await db.schema.alterTable("entitlements").dropColumn("pass_ending_sent_at").execute();
  await db.schema.alterTable("entitlements").dropColumn("renewal_reminder_period_end").execute();
}
