import type { MigrationDb } from "./types";

/**
 * Who is allowed to sign up, when the instance is invite-only — B1693.
 *
 * `features.signup.inviteOnly` (default true) narrows signup from "anybody
 * who finds the domain" to "these addresses". This is the list. One row per
 * address, the address itself the primary key, so adding the same person
 * twice is one row rather than a second the first can disagree with.
 *
 * **An entry is permission to be sent the first code, and nothing else.** A
 * listed address still does the whole normal signup — email code, phone
 * number, phone verification. Nothing here is a credential, nothing here is
 * pre-verified, and a row is not consumed by a signup: the owner chose
 * permanent-until-removed so a signup that dies half-way can be restarted
 * without the operator being asked to re-add somebody.
 *
 * `added_by` is the operator's own address off their `/admin` cookie — the
 * only writer — kept because an instance with two operators otherwise has no
 * way to ask who let somebody in. `note` is free text for the same reason a
 * bookmark has a title.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("signup_invites")
    // Instance state, not a journal's — the same shape and the same reasoning
    // as `admin_acks` (`030-admin-acks`): every table in this schema carries
    // `owner_id`, and a row belonging to the instance writes `NO_JOURNAL`
    // into it. Deleting a journal must not take an invite with it; the
    // address can still be here after the journal it made has gone.
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.primaryKey().notNull())
    .addColumn("added_at", "text", (c) => c.notNull())
    .addColumn("added_by", "text")
    .addColumn("note", "text")
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("signup_invites").execute();
}
