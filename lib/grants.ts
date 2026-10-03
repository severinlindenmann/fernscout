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
 * The two tiers a grant's `scope` can hold (B1749). `read` opens what a guest
 * sees; `close` opens that and everything marked `private`. A contact has one
 * row, so one tier — never both. `lib/access.ts` decides what each opens.
 */
export const GRANT_SCOPES = ["read", "close"] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

/** A contact's live tier on this journal, or null when they hold no live grant. */
export async function grantScopeOf(
  owner: string,
  contactId: string,
  now: Date = new Date(),
): Promise<GrantScope | null> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("access_grants")
    .select(["expires_at", "scope"])
    .where("owner_id", "=", owner)
    .where("contact_id", "=", contactId)
    .where("scope", "in", [...GRANT_SCOPES])
    .execute();
  const live = rows.filter((row) => grantIsLive(row.expires_at, now));
  // Fail closed to the lower tier should two rows ever exist.
  if (live.length === 0) return null;
  return live.some((row) => row.scope === "read") ? "read" : "close";
}

/**
 * Whether one contact holds a live grant of either tier on this journal.
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
  return (await grantScopeOf(owner, contactId, now)) !== null;
}

/**
 * Move a contact between the tiers. Only an existing live grant moves — this
 * never creates one (`approveContact` is the only writer of that), so a
 * revoked or never-approved contact cannot be promoted into access.
 */
export async function setGrantScope(
  owner: string,
  contactId: string,
  scope: GrantScope,
  now: Date = new Date(),
): Promise<boolean> {
  if ((await grantScopeOf(owner, contactId, now)) === null) return false;
  const { db } = await getDatabase();
  await db
    .updateTable("access_grants")
    .set({ scope })
    .where("owner_id", "=", owner)
    .where("contact_id", "=", contactId)
    .where("scope", "in", [...GRANT_SCOPES])
    .execute();
  return true;
}

/**
 * Every contact of this owner holding a live grant, of either tier.
 *
 * One query for the whole digest run rather than one per contact: fifty
 * readers is not a lot of rows, and a per-contact query inside the send loop is
 * how a cron job starts taking minutes.
 */
export async function contactsWithReadGrant(owner: string, now: Date): Promise<Set<string>> {
  return new Set((await grantScopes(owner, now)).keys());
}

/** The contacts of this owner in the close circle (live `close` grants). */
export async function closeCircleContacts(owner: string, now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  for (const [id, scope] of await grantScopes(owner, now)) if (scope === "close") out.add(id);
  return out;
}

async function grantScopes(owner: string, now: Date): Promise<Map<string, GrantScope>> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("access_grants")
    .select(["contact_id", "expires_at", "scope"])
    .where("owner_id", "=", owner)
    .where("scope", "in", [...GRANT_SCOPES])
    .execute();

  const out = new Map<string, GrantScope>();
  for (const row of rows) {
    if (!grantIsLive(row.expires_at, now)) continue;
    if (out.get(row.contact_id) !== "read") out.set(row.contact_id, row.scope as GrantScope);
  }
  return out;
}
