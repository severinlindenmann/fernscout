import type { MigrationDb } from "./types";

/**
 * The link in a "are you sure you want to delete this" mail.
 *
 * A separate mechanism from `lib/agentConfirm.ts`, and the difference is the
 * whole reason this table exists. That one is stateless on purpose — an HMAC
 * over the operation, with no row to burn — which makes it deliberately *not*
 * single-use, and it hands the code **to the agent**. For removing a draft day
 * that is the right trade: the second refusal is there to make an agent stop
 * and think, not to be cryptographically final.
 *
 * A journal is not a draft day. It is somebody's photographs and every word
 * they wrote, and the failure this has to survive is an agent that reads "get
 * rid of that test entry" as "get rid of that journal" and then satisfies its
 * own confirmation. So the credential goes to the **owner's mailbox**, not to
 * the caller, and it is single-use — which needs somewhere to record that it
 * was used, which is this table.
 *
 * Everything else follows the house rules for a bearer credential: the token
 * is 32 random bytes, stored as a sha-256 hash, and the row names the exact
 * target so a link mailed for one trip cannot remove another.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("deletion_requests")
    .addColumn("id", "text", (c) => c.primaryKey())
    // The journal. Every table here keys on it, and a journal deletion sweeps
    // all of them by this column.
    .addColumn("owner_id", "text", (c) => c.notNull())
    // "journal" | "trip". Signed into nothing — the row *is* the record, and
    // the token only resolves to this row.
    .addColumn("kind", "text", (c) => c.notNull())
    // Which trip, when the kind is "trip". Null for a journal.
    .addColumn("trip_id", "text")
    // Where the mail went: the address in the journal's own config.json at the
    // time of asking, never the address on the token that asked.
    .addColumn("email", "text", (c) => c.notNull())
    // sha-256 of the token in the URL. The token exists only in the mail.
    .addColumn("token_hash", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("expires_at", "text", (c) => c.notNull())
    // Set the moment the link is spent, before anything is deleted. A second
    // press of the same button finds a consumed row and is refused.
    .addColumn("consumed_at", "text")
    // The session that asked, so a deletion can be traced back to a token.
    // Not a foreign key: the session row is deleted by the very sweep this
    // request authorises.
    .addColumn("requested_by", "text")
    .execute();

  // The token is the entire lookup key. There is no address in the URL to
  // narrow by — the same reasoning as the sign-in link in 005-signin-link.
  await db.schema
    .createIndex("deletion_requests_token")
    .on("deletion_requests")
    .columns(["token_hash"])
    .execute();

  await db.schema
    .createIndex("deletion_requests_owner")
    .on("deletion_requests")
    .columns(["owner_id"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("deletion_requests_owner").execute();
  await db.schema.dropIndex("deletion_requests_token").execute();
  await db.schema.dropTable("deletion_requests").execute();
}
