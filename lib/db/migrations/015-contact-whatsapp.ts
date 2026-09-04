import type { MigrationDb } from "./types";

/**
 * Whether a contact agreed to be messaged on WhatsApp — B365.
 *
 * **A column of its own, and not a reuse of `wants_email_digest`.** The two
 * look interchangeable and are not: Meta's Business Messaging Policy wants
 * explicit opt-in to be messaged *on WhatsApp specifically*, and a reader who
 * ticked "send me the digest" agreed to an email. Treating that as consent
 * for a different channel is how a business phone number gets reported and
 * banned — a loss that takes the whole journal's WhatsApp with it, not just
 * one reader's.
 *
 * There is a second reason, and it survives even if Meta's policy changes.
 * The telephone number these messages go to was collected on the guestbook
 * screen *next to the postal address*, for postcards
 * (`PostalAddress.tel`, `lib/contacts/crypto.ts`). Nobody who typed it there
 * was told it might one day be used for anything else. A separate switch,
 * defaulting to zero, is the only reading of that number that does not
 * retroactively rewrite what somebody agreed to.
 *
 * Defaults to `0` for exactly that reason: every contact that exists on any
 * instance today has not opted in, and absence must read as "no".
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .alterTable("contacts")
    .addColumn("wants_whatsapp", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contacts").dropColumn("wants_whatsapp").execute();
}
