import "server-only";
import { isIndexable, isOpenToLink } from "../access";
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
 * Three cases, and the two interesting ones are the trips that are *not* public:
 *
 * - **public** (`isIndexable`) — anyone may see it listed, so anyone on the
 *   digest list may be told about it.
 * - **unlisted** — reachable by link, but deliberately not advertised. Mailing
 *   it to everybody who ever signed the guestbook *is* advertising it, so it
 *   goes only to readers the owner has actually granted (the `read` grant that
 *   approving a contact creates). This is the same distinction `listableTrips`
 *   draws for the trip switcher.
 * - **guest and private** — never. This was once simply true: the gate had no
 *   database behind it, so a grant did not open it, and a digest cannot carry
 *   a password. B41 changed half of that and B39 finished it — a `guest` trip
 *   is now opened by a live grant and by nothing else, so a line about one
 *   would no longer be a link to a door the reader has no key for. Widening
 *   this function to match is B52, and deliberately not done here: it changes
 *   what lands in somebody's inbox, which is the owner's call and not a side
 *   effect of changing the gate. `private` stays never, whatever else changes.
 *
 * A grant is journal-wide — one bit, not a set of trip ids. It said which trip
 * until `007-journal-wide-grants`, and nothing ever wrote anything but `*`.
 * Whether it is live is `lib/grants.ts`, which is the one place that decides.
 */

/** Trips a reader may be told about. `granted` is whether they hold a `read`
 * grant on this journal at all. */
export function digestableTrips(trips: Trip[], granted: boolean): Trip[] {
  return trips.filter((trip) => {
    if (isIndexable(trip)) return true;
    // `guest` and `private`: excluded even with a grant. See above — this is
    // deliberately narrower than the gate, and B52 is where that is revisited.
    if (!isOpenToLink(trip)) return false;
    return granted;
  });
}
