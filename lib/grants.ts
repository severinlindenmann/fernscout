import "server-only";
import { getDatabase } from "./db";

/**
 * Who has been let into a journal, and until when.
 *
 * One row in `access_grants` says: *this contact may read this journal*. It is
 * journal-wide and always has been — the table carried a `trip_id` until
 * `007-journal-wide-grants`, nothing ever wrote anything but `*` into it, and
 * the column is gone. A trip that must be held back from the people who are
 * otherwise let in is `visibility: private`; there is deliberately no narrower
 * grant to reach for.
 *
 * **This module is the only place that decides whether a grant is live**, and
 * that is the point of it. Before B41 the digest asked one question (`is the
 * row there and unexpired?`) and the access panel asked another (`is the
 * contact "active"?`), and the trip gate asked neither — which is how the site
 * came to tell somebody they could read a trip and then refuse them. Three
 * readers, three answers. Now there is one answer, and every surface calls in
 * here for it.
 */

/**
 * An expired grant is not a grant.
 *
 * `expires_at` is null for every grant `approveContact` writes today, so this
 * is a rule with no data behind it yet. It is enforced anyway, because the
 * column is the only way the schema can express "let in until Christmas", and
 * a rule that is only honoured by whichever reader remembered it is worse than
 * no rule. Compared as ISO strings: that is what the schema stores and what
 * sorts correctly.
 *
 * **Decided, rather than left open (B178).** A grant is permanent until the
 * owner revokes it, and REST takes no expiry — approving
 * somebody is the owner saying "you are welcome here", not "you are welcome
 * here until March", and an access list that silently empties itself is a
 * worse surprise than one the owner has to prune. The column stays, and stays
 * enforced, so that "let them in until Christmas" is one writer away rather
 * than one migration and one writer away; the consequence to know is that no
 * expired grant can exist on a running instance, so this rule is observable
 * only in `test/access-gate.test.ts` and that is not a gap.
 */
export function grantIsLive(expiresAt: string | null, now: Date): boolean {
  return expiresAt === null || expiresAt > now.toISOString();
}

/**
 * Whether one contact holds a live `read` grant on this journal.
 *
 * A single indexed row, because this is asked during a page render — once per
 * gated trip page, for a signed-in reader only. The anonymous case never gets
 * this far: `mayReadTrip` has no contact to look up without a session.
 */
export async function hasReadGrant(
  owner: string,
  contactId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("access_grants")
    .select(["expires_at"])
    .where("owner_id", "=", owner)
    .where("contact_id", "=", contactId)
    .where("scope", "=", "read")
    .executeTakeFirst();
  return row !== undefined && grantIsLive(row.expires_at, now);
}

/**
 * Every contact of this owner holding a live `read` grant.
 *
 * One query for the whole digest run rather than one per contact: fifty
 * readers is not a lot of rows, and a per-contact query inside the send loop is
 * how a cron job starts taking minutes.
 */
export async function contactsWithReadGrant(owner: string, now: Date): Promise<Set<string>> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("access_grants")
    .select(["contact_id", "expires_at"])
    .where("owner_id", "=", owner)
    .where("scope", "=", "read")
    .execute();

  const out = new Set<string>();
  for (const row of rows) {
    if (grantIsLive(row.expires_at, now)) out.add(row.contact_id);
  }
  return out;
}
