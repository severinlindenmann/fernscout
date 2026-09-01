import "server-only";
import { isIndexable, isOpenToLink } from "../access";
import { getDatabase } from "../db";
import type { Trip } from "../types";

/**
 * Which trips a digest may mention to a given reader.
 *
 * The rule this file enforces is one sentence: **a digest never contains a line
 * about a trip the reader cannot open.** A mail saying "3 new days in Vietnam"
 * that leads to a password box is worse than no mail — it tells somebody
 * something private exists and then refuses them, which is the one thing a
 * private trip is for.
 *
 * Three cases, and the two interesting ones are the trips that are *not* public:
 *
 * - **public** (`isIndexable`) — anyone may see it listed, so anyone on the
 *   digest list may be told about it.
 * - **unlisted** — reachable by link, but deliberately not advertised. Mailing
 *   it to everybody who ever signed the guestbook *is* advertising it, so it
 *   goes only to readers the owner has actually granted (the `read` grant that
 *   approving a contact creates). This is the same distinction `listableTrips`
 *   draws for the trip switcher.
 * - **password** — never. Not even for a reader with a grant: the password gate
 *   (W09, `lib/tripGate.ts`) has no database behind it by design, so a grant
 *   does not open it, and a digest cannot carry the password. Until identified
 *   access can actually unlock the gate, a line about one of these trips would
 *   be a link to a door the reader has no key for. When that lands, this
 *   function is the single place that changes.
 *
 * A grant is journal-wide — one bit, not a set of trip ids. It said which trip
 * until `007-journal-wide-grants`, and nothing ever wrote anything but `*`.
 */

/** Trips a reader may be told about. `granted` is whether they hold a `read`
 * grant on this journal at all. */
export function digestableTrips(trips: Trip[], granted: boolean): Trip[] {
  return trips.filter((trip) => {
    if (isIndexable(trip)) return true;
    // Password-protected: excluded even with a grant. See above.
    if (!isOpenToLink(trip)) return false;
    return granted;
  });
}

/**
 * Every contact of this owner holding a live `read` grant.
 *
 * One query for the whole run rather than one per contact: fifty readers is
 * not a lot of rows, and a per-contact query inside the send loop is how a
 * cron job starts taking minutes.
 */
export async function contactsWithReadGrant(
  owner: string,
  now: Date,
): Promise<Set<string>> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("access_grants")
    .select(["contact_id", "expires_at"])
    .where("owner_id", "=", owner)
    .where("scope", "=", "read")
    .execute();

  const stamp = now.toISOString();
  const out = new Set<string>();
  for (const row of rows) {
    // An expired grant is not a grant. Compared as ISO strings, which is what
    // the schema stores and what sorts correctly.
    if (row.expires_at !== null && row.expires_at <= stamp) continue;
    out.add(row.contact_id);
  }
  return out;
}
