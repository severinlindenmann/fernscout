import type { MigrationDb } from "./types";

/**
 * The invite token, recoverable by its owner — B280.
 *
 * `token_hash` stays, and stays the only thing redemption looks at: a lookup
 * by hash is what makes it one indexed comparison rather than a decrypt of
 * every row, and the hash is what a constant-time compare needs. This column
 * is beside it, not instead of it.
 *
 * It exists because a link could be sent exactly once. The owner closed the
 * page, the URL was gone, and sending the family link to one more cousin meant
 * issuing a second link for the same audience — a row per cousin, each with a
 * note to re-type, and revoking the right one later a guess. B97 is the same
 * failure one step earlier.
 *
 * **This is a live credential at rest, and that is a real cost.** Before it, a
 * database dump yielded hashes and no way in. So the plaintext is not what is
 * stored: it is AES-256-GCM under `CONTACTS_ENCRYPTION_KEY`, in the scheme
 * `lib/contacts/crypto.ts` already uses for postal addresses, with an AAD of
 * `invite:<owner>:<invite id>` binding each ciphertext to its row. Reading it
 * now needs the environment as well as the database, which is the property the
 * hash alone was buying.
 *
 * Rows written before this migration have no plaintext to recover and never
 * will. They keep redeeming; their copy action is simply absent. Deliberately
 * not backfilled — there is nothing to backfill from, and inventing a new
 * token for an existing row would silently break a link somebody had already
 * sent.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contact_invites").addColumn("token_cipher", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contact_invites").dropColumn("token_cipher").execute();
}
