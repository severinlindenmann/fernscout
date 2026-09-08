import { sql } from "kysely";
import type { MigrationDb } from "./types";

/**
 * A stored credit becomes a **hundredth** of a credit — B987.
 *
 * The column stays an integer and the debit stays one conditional `UPDATE`;
 * what changes is what a stored unit *means*. That is the whole reason this is
 * a migration of data rather than of type: every property `lib/credits.ts` is
 * arranged around — a balance that cannot go below zero under concurrency, a
 * `grant` allowlist of three callers, an append-only ledger of signed deltas —
 * survives a change of unit and would not survive a `real` column, which would
 * have handed us 0.1 + 0.2 in a place where money is counted.
 *
 * Why it was needed: `spend()` refused a fraction outright, so the smallest
 * thing this product could charge for was one whole credit — the price of a
 * six-second spoken question as much as of a five-minute dictation. Speech is
 * metered by the second at the provider and was billed here in lumps seventy
 * times larger than the smallest sensible one.
 *
 * **Everything outside `lib/credits.ts` still speaks in credits.** `spend`,
 * `grant`, `refund` and `balanceOf` convert at the boundary, so
 * `POSTCARD_CREDITS` is still 20 and still means twenty credits. No price
 * constant was multiplied by hand, which is the class of mistake a unit
 * change usually ships with.
 *
 * Both tables in one transaction: a balance in hundredths beside a ledger in
 * whole credits is a journal whose receipt no longer adds up.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await sql`UPDATE credits SET balance = balance * 100`.execute(trx);
    await sql`UPDATE credit_ledger SET delta = delta * 100`.execute(trx);
  });
}

/**
 * Back to whole credits, and it is lossy on purpose.
 *
 * Anything charged in hundredths since the migration cannot survive the trip
 * back — a spend of 2 is a fiftieth of a credit and there is no such thing
 * below. Integer division truncates, which rounds every balance **down**: a
 * journal loses at most 99 hundredths, and nobody's balance is invented
 * upwards by a rollback.
 */
export async function down(db: MigrationDb): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await sql`UPDATE credits SET balance = balance / 100`.execute(trx);
    await sql`UPDATE credit_ledger SET delta = delta / 100`.execute(trx);
  });
}
