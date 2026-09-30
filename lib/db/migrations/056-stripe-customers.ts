import type { MigrationDb } from "./types";

/**
 * One Stripe customer per owner — B2593.
 *
 * Created the first time an owner reaches a Checkout Session for a pass or
 * Plus (never for the credit-pack flow, which has never needed one). Kept so
 * a second checkout, the Customer Portal link, and a subscription renewal all
 * refer to the same Stripe customer rather than a stray fourth one.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("stripe_customers")
    .addColumn("owner_id", "text", (c) => c.primaryKey().notNull())
    .addColumn("customer_id", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("stripe_customers_customer_id_unique")
    .on("stripe_customers")
    .column("customer_id")
    .unique()
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("stripe_customers").execute();
}
