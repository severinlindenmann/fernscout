import type { MigrationDb } from "./types";

/**
 * "News from Fernscout" — the instance-wide marketing tick on the notify step
 * (B2453). Deliberately not a `contacts` column: this is one list per address,
 * across every journal the same person reads, never a per-journal preference
 * (Swiss UWG Art. 3 lit. o and GDPR both ask for consent to *this*, not to a
 * particular owner's digest — `wants_email_digest` on `contacts` stays what it
 * always was).
 *
 * `email` (normalised the same way `contacts.email_key` is — see
 * `normaliseEmail`) is the primary key, so ticking twice or across two
 * journals is the same row. Presence of the row *is* the consent; unticking
 * deletes it outright rather than flipping a flag, so a data-protection
 * export or audit never has to tell "revoked" apart from "never asked" — a
 * dropped row already means "no address to hold". `wording_key` and `locale`
 * are what was actually shown when it was given, so an audit answers with
 * more than "yes" — a wording change never rewrites what an old consent
 * proves.
 *
 * `owner_id` is always `NO_JOURNAL` ("*"), as in 045–047: every table carries
 * one so a journal deletion can sweep by it, and this one holds no journal's
 * rows — a reader's wish to hear from Fernscout is theirs, not the journal's.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("news_consent")
    .addColumn("email", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull().defaultTo("*"))
    .addColumn("wording_key", "text", (c) => c.notNull())
    .addColumn("locale", "text")
    .addColumn("consented_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("news_consent").execute();
}
