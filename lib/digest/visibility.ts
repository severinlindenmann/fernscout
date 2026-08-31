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
 *   goes only to readers the owner has actually granted (a `read` grant on `*`
 *   or on that trip, which is what approving a contact creates). This is the
 *   same distinction `listableTrips` draws for the trip switcher.
 * - **password** — never. Not even for a reader with a grant: the password gate
 *   (W09, `lib/tripGate.ts`) has no database behind it by design, so a grant
 *   does not open it, and a digest cannot carry the password. Until identified
 *   access can actually unlock the gate, a line about one of these trips would
 *   be a link to a door the reader has no key for. When that lands, this
 *   function is the single place that changes.
 */

/** Trips a reader holding `granted` may be told about. */
export function digestableTrips(trips: Trip[], granted: ReadonlySet<string>): Trip[] {
  return trips.filter((trip) => {
    if (isIndexable(trip)) return true;
    // Password-protected: excluded even with a grant. See above.
    if (!isOpenToLink(trip)) return false;
    return granted.has("*") || granted.has(trip.id);
  });
}

/**
 * Every live `read` grant for this owner, as contact id → trip ids.
 *
 * One query for the whole run rather than one per contact: fifty readers times
 * a handful of trips is not a lot of rows, and a per-contact query inside the
 * send loop is how a cron job starts taking minutes.
 */
export async function readGrantsByContact(
  owner: string,
  now: Date,
): Promise<Map<string, Set<string>>> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("access_grants")
    .select(["contact_id", "trip_id", "expires_at"])
    .where("owner_id", "=", owner)
    .where("scope", "=", "read")
    .execute();

  const stamp = now.toISOString();
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    // An expired grant is not a grant. Compared as ISO strings, which is what
    // the schema stores and what sorts correctly.
    if (row.expires_at !== null && row.expires_at <= stamp) continue;
    const set = out.get(row.contact_id) ?? new Set<string>();
    set.add(row.trip_id);
    out.set(row.contact_id, set);
  }
  return out;
}
