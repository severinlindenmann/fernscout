import type { MigrationDb } from "./types";

/**
 * The session that belongs to an address rather than to a journal — B410.
 *
 * Every session before this one names a journal in `owner_id`, because every
 * session before this one *was* access to a journal. An identity session is
 * the opposite: it proves an address and authorises nothing at all. What it is
 * for is the question the schema could not previously answer — "which journals
 * on this instance may this person open?" — which needs a credential that
 * outlives the choice of journal.
 *
 * One column, and no new table. A separate `identities` table was the first
 * shape and this replaced it: revocation, expiry, `last_seen_at` and the
 * hashed-token lookup are the same four problems `sessions` already solves,
 * and a second table would have been a second `lookUpSession` to keep honest.
 * The wall between the kinds is enforced in code — `lookUpSession` compares
 * `kind` against what the caller asked for — and that wall does not get
 * stronger for being drawn between two tables.
 *
 * **No `parent_id`, and that is a decision rather than an omission.** The
 * design this was built from had an identity mint a per-journal session and
 * kept the parentage so revocation could cascade. It earns nothing: every gate
 * re-derives access from the address on each request anyway — `journalReader`
 * asks `hasReadGrant`, `isOwner` reads `config.json` — so the minted session
 * saved no work and only created rows a revocation then had to chase.
 * Revoking an identity now ends it, full stop, because there is nothing
 * downstream of it to outlive it.
 */
export async function up(db: MigrationDb): Promise<void> {
  /**
   * An opaque public name for an identity — B412.
   *
   * The service worker has to keep one reader's cached data apart from the
   * next reader's, which means naming a cache after the reader. It cannot use
   * the token: `fs_identity` is httpOnly, which is the correct state and must
   * stay that way. So the identity gets a second value that is safe to say out
   * loud — returned in a response body, written into IndexedDB, and never
   * accepted as authentication anywhere.
   *
   * Random rather than derived from the address. A hash of an email is not an
   * opaque id; it is the email, for anybody holding a list of candidates.
   */
  await db.schema.alterTable("sessions").addColumn("public_id", "text").execute();

  // The device list on the home view is "every identity for this address",
  // which is a scan of the table without this.
  await db.schema
    .createIndex("sessions_kind_owner")
    .on("sessions")
    .columns(["kind", "owner_id"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("sessions_kind_owner").execute();
  await db.schema.alterTable("sessions").dropColumn("public_id").execute();
}
