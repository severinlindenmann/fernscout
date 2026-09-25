import type { MigrationDb } from "./types";

/**
 * When the owner was actually told about a confirmation — B272.
 *
 * `notifyOwnerOfRequest` used to be a side effect of the request that
 * confirmed: sent once, gated on `confirmed_at === null` so a reader
 * recovering their link never put a second request in front of the owner.
 * That guard was correct and this column does not touch it — what it fixes is
 * that the mail itself was never durable. A transient SMTP failure right after
 * `confirmed_at` was written left the row looking exactly like a successful,
 * fully-notified confirmation, and there was no way left to tell the two
 * apart, let alone retry.
 *
 * Null until `notifyOwnerOfRequest` returns success; `confirmContact` and
 * `confirmContactFromSession` read it back as `needsOwnerNotice`. A reader
 * whose owner-notice failed can simply ask for a fresh code and confirm
 * again — the address is already proved, so re-confirming is a no-op for
 * everything *except* this column, which is exactly the retry this exists
 * for.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contacts").addColumn("notified_at", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contacts").dropColumn("notified_at").execute();
}
