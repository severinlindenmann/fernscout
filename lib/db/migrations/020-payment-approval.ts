import type { MigrationDb } from "./types";

/**
 * A payment is now a request an admin approves, and approving grants the
 * credits — B425. These columns hold the approval half.
 *
 * `approve_token_hash` is the sha-256 of a single-use token that is mailed to
 * the instance operator (`site.operatorEmail`) and to nobody else. Whoever
 * holds it can approve this one purchase — which grants real credits — so
 * unlike the payment id (a view/pay handle worth nothing) it is stored hashed,
 * like every other bearer credential in this schema. Null except while a
 * request is awaiting approval; cleared the moment it is spent.
 *
 * `granted` is the idempotency guard. The approve step flips
 * `requested → paid` and `granted 0 → 1` in one conditional UPDATE, so credits
 * are granted at most once however many times the link is followed.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("payments").addColumn("approve_token_hash", "text").execute();
  await db.schema
    .alterTable("payments")
    .addColumn("granted", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable("payments").addColumn("requested_at", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("payments").dropColumn("requested_at").execute();
  await db.schema.alterTable("payments").dropColumn("granted").execute();
  await db.schema.alterTable("payments").dropColumn("approve_token_hash").execute();
}
