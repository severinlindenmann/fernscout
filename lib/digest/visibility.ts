import "server-only";
import { isIndexable } from "../access";
import type { Trip } from "../types";

/**
 * Which trips a digest may mention to a given reader.
 *
 * The rule this file enforces is one sentence: **a digest never contains a line
 * about a trip the reader cannot open.** A mail saying "3 new days in Vietnam"
 * that leads to a locked page is worse than no mail — it tells somebody
 * something private exists and then refuses them, which is the one thing a
 * private trip is for.
 *
 * Four cases, and the interesting ones are the trips that are *not*
 * advertised:
 *
 * - **public and listed** (`isIndexable`) — anyone may see it in the sitemap,
 *   so anyone on the digest list may be told about it.
 * - **public but unlisted** — reachable by link, and deliberately not
 *   advertised. Mailing it to everybody who ever signed the guestbook *is*
 *   advertising it, so it goes only to readers the owner has actually granted
 *   (the `read` grant that approving a contact creates). This is the same
 *   distinction `listableTrips` draws for the trip switcher.
 * - **guest** — the same readers, for a stronger reason: a live grant is now
 *   the only door into one (B41 made the grant open the gate, B39 removed the
 *   password that used to stand in front of it), so a grant-holder told about
 *   a `guest` trip can open it and nobody else is told at all. This was once
 *   excluded outright, when the gate had no database behind it and a digest
 *   could not carry a password; B52 widened it, because a trip written for
 *   exactly the people the owner invited was the one trip those people were
 *   never told about.
 * - **private** — never, for anybody. Not the journal's guests, whom
 *   `mayReadTrip` refuses before it asks anything else, and not the people on
 *   `people:` either: they can open it, but the digest is addressed by contact
 *   and has no way to know a contact is also a traveller. Refusing is the
 *   fail-safe direction, and the same line push draws (B68).
 *
 * ## Why this is a subset of the gate, and stays one
 *
 * `mayReadTrip` (`lib/tripGate.ts`) is the only thing that decides whether the
 * link in the mail opens. This function must never mention a trip that would
 * refuse — the pairing is asserted trip-by-trip and reader-by-reader in
 * `test/access-gate.test.ts`, against the same table the gate itself is pinned
 * to, so a change to either side that pulls them apart fails there.
 *
 * The two are matched by `granted`, and that word has to mean the same thing on
 * both sides. Here it is a live `read` grant (`contactsWithReadGrant`); at the
 * gate it is `isJournalGuest`, which is an **active** contact holding a live
 * grant. `planDigest` skips every contact that is not `active` before it gets
 * this far, which is what closes the gap — revoking a contact clears both, so
 * the two conditions do not come apart in practice, but the digest's version is
 * the looser of the two and the status check above it is load-bearing.
 *
 * A grant is journal-wide — one bit, not a set of trip ids. It said which trip
 * until `007-journal-wide-grants`, and nothing ever wrote anything but `*`.
 * Whether it is live is `lib/grants.ts`, which is the one place that decides.
 */

/** Trips a reader may be told about. `granted` is whether they hold a `read`
 * grant on this journal at all. */
export function digestableTrips(trips: Trip[], granted: boolean): Trip[] {
  return trips.filter((trip) => {
    // First, and whatever else changes: `private` is nobody's to be told about.
    if (trip.visibility === "private") return false;
    // Already advertised to the world, so a mail advertises nothing new.
    if (isIndexable(trip)) return true;
    // Everything left is a trip the owner keeps off the listings — a `guest`
    // trip, or a public one with `listed: false`. Both go only to a reader the
    // owner has actually let in, which is the same grant the gate asks for.
    return granted;
  });
}
