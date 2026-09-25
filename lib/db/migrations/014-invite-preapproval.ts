import type { MigrationDb } from "./types";

/**
 * Which address an invite was mailed to, so redeeming it can skip the queue —
 * B319.
 *
 * An invite has never carried an email (see `010-invite-links`'s doc comment:
 * "it is an invitation to *request*, not a grant"), because forwarding one was
 * meant to be harmless — several people could fill in the same form and each
 * would still wait for the owner. That is unchanged for a link copied by hand.
 *
 * What is new is a link the owner asks the server to **mail** to somebody
 * named. There the owner has already vouched for the address by typing it, and
 * the decision (see B319's task file) is to pre-approve exactly that address:
 * whoever proves it is admitted without a second decision in the owner's
 * queue. `email_key` is what makes that address-specific rather than
 * link-specific — a forwarded copy of the same link, redeemed by a different
 * address, still lands in the queue like any other, because the row it wrote
 * does not match this column.
 *
 * Case-folded, like `contacts.email_key`, so the comparison at confirmation is
 * a simple equality — and named the same for the same reason: it is a lookup
 * key, not the address to show anybody. Null for every invite that was never
 * mailed, which is every row before this and every link an owner still copies
 * by hand.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contact_invites").addColumn("email_key", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contact_invites").dropColumn("email_key").execute();
}
