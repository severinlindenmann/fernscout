import type { MigrationDb } from "./types";

/**
 * The Stripe checkout session a payment is being paid through — B831.
 *
 * Without it, `POST .../pay` had no way to find the session it made last time,
 * so every press minted a *fresh* one and a distracted buyer could end up with
 * two payable sessions for one purchase — pay both and they are charged twice
 * and credited once (the row grants at most once). Storing the id lets the pay
 * route reuse a session that is still open instead of opening a rival to it, so
 * at most one session is ever payable for a row at a time.
 *
 * Nullable, and only ever holds the *latest* session id: a superseded
 * (expired) session is simply replaced. It is not a credential and not the
 * grant path — the webhook still grants only against the stored amount — so it
 * is stored plainly, unlike `approve_token_hash`.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("payments").addColumn("provider_ref", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("payments").dropColumn("provider_ref").execute();
}
