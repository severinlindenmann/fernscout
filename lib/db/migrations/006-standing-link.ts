import type { MigrationDb } from "./types";

/**
 * A sign-in link that does not expire, for the mail that creates a journal.
 *
 * Every other link on this table is a companion to a six-digit code and dies
 * with it. The welcome mail is different in two ways that both matter: it is
 * the owner's *first* way into their own journal, and it may sit unopened for
 * a week — a link that expires in half an hour is one they will never use. It
 * also has no code beside it, because there is nothing for them to type in;
 * they were not signing in, they were told their journal exists.
 *
 * ## Why a permanent link is not the risk it sounds like
 *
 * `005-signin-link.ts` argues that a link is the *weaker* of the two
 * credentials, and it is right: a link travels in a URL, so it is prefetched
 * by mail scanners, copied into chat windows and written to browser history.
 * Entropy is not the question — the token is 256 bits — exposure is.
 *
 * What bounds the exposure is **single use**, which is unchanged here. The
 * first fetch consumes the link, so a permanent link is self-limiting rather
 * than indefinitely replayable; a scanner that follows it burns it, and the
 * owner falls back to asking for an ordinary code. That is exactly the
 * fallback the two-credential design exists to provide.
 *
 * ## Why a column rather than a far-future date
 *
 * A sentinel date is a lie that works until somebody reads it. `link_standing`
 * says what is meant, and it **defaults to 0**, so every row written by code
 * that does not know about this behaves exactly as it does today. A forgotten
 * call site produces a link that expires, not one that never does — the
 * failure that costs somebody a second email rather than the one that leaves a
 * credential live for ever.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .alterTable("login_codes")
    .addColumn("link_standing", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("login_codes").dropColumn("link_standing").execute();
}
