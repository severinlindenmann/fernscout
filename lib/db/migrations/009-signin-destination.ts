import type { MigrationDb } from "./types";

/**
 * Where the sign-in link should land.
 *
 * The button in a sign-in mail always redirected to `/<username>`, and while
 * the form lived only on `/<user>/me` that was the right place. B39 put the
 * same form in front of every closed trip, so the ordinary path became: open
 * a link to a trip, meet the gate, ask for a code, tap the button — and arrive
 * on a front page that does not mention the trip you came for. A `guest` trip
 * is never listed, so for that reader the link simply did not work.
 *
 * **The destination is stored, never echoed.** It travels from the form to
 * `/api/auth/request`, into this column beside the link's hash, and out again
 * at redemption — it is not in the mailed URL and there is no query parameter
 * anywhere that sets it. A redirect target that arrives in the request that
 * *follows* it is an open redirect; one that was written down when the code
 * was issued is a note to self. It is still validated on the way out (see
 * `safeDestination`), because a column is a place an attacker with any write
 * at all would aim for.
 *
 * Null for every row written before this migration, for every agent code —
 * an agent has no browser to land anywhere — and for the sign-in mails that
 * carry no destination at all: the digest footer, the contact mail, and the
 * form on `/<user>/me`, all of which should keep landing on the journal.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("login_codes").addColumn("link_dest", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("login_codes").dropColumn("link_dest").execute();
}
