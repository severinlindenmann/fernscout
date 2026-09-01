import "server-only";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isOpenToLink, isRestricted, maySeeCosts, tripCookieName, verifyTripToken } from "./access";
import { GUEST_COOKIE, resolveSession } from "./auth";
import { isJournalGuest } from "./contacts/session";
import { isPersonOn } from "./tripPeople";
import type { Trip } from "./types";

/**
 * Whether the current request may read this trip.
 *
 * **Every gated page must call this itself.** It is tempting to check once in
 * the route group's layout and treat the pages below as covered — that is what
 * this code did, and it leaked. A layout returning something other than
 * `children` changes what is *displayed*; it does not stop the page component
 * from running, and the page's data is serialised into the RSC payload and the
 * document's `<head>` either way. A password-protected trip was shipping its
 * day index — dates, locations, coordinates, per-day spend — plus JSON-LD for
 * every day and the day's own prose in `<meta name="description">`, to anybody
 * who opened the URL without the password.
 *
 * So: pages return `null` when this says no (the layout draws the form), and
 * `generateMetadata` returns `lockedMetadata` instead of the real thing.
 * Everything that lists or links trips filters separately — see lib/access.ts.
 */
export async function mayReadTrip(trip: Trip): Promise<boolean> {
  if (isOpenToLink(trip)) return true;

  // The people who took it are always let in, whichever way the trip is
  // closed. Somebody who was on the bus should not need a password to read
  // their own week, and for a `private` trip they are the only way in.
  if (await isTravellerOn(trip)) return true;

  // `private` is the people who were there, and nobody else — not the people
  // the owner has let into the journal, and not a password holder. It is the
  // one thing being a guest does not widen, and the reason there are three
  // visibility values rather than two: invite the family to the journal and
  // every non-public trip becomes theirs to read unless one word can hold a
  // trip back.
  if (trip.visibility === "private") return false;

  // `guest`: an invitation to the journal, or the trip's password.
  //
  // The invitation is the door B41 added. `isJournalGuest` is the same call
  // `resolveViewer` makes to decide what to *list* on `/<user>/me`, so a trip
  // shown there under "what you can read" is a trip this returns true for.
  // Before, the panel said yes and this said no, and the reader met a password
  // form for a password nobody had ever sent them.
  if (await isJournalGuest(trip.username)) return true;

  const jar = await cookies();
  return verifyTripToken(trip, jar.get(tripCookieName(trip.ref))?.value);
}

/**
 * Whether the signed-in reader took this trip.
 *
 * A guest session carries the address it was issued to, which is the same
 * address `people:` lists. That is the whole mechanism — no separate
 * membership store, because the trip's own frontmatter is the record.
 */
export async function isTravellerOn(trip: Trip): Promise<boolean> {
  const jar = await cookies();
  const session = await resolveSession(jar.get(GUEST_COOKIE)?.value, "guest");
  if (!session || session.owner !== trip.username) return false;
  return isPersonOn(trip, session.email);
}

/**
 * The only metadata a locked trip may emit.
 *
 * The trip's own title, because the gate says which trip it is guarding and
 * the browser tab should agree. Nothing else: no day title, no description
 * drawn from the day's prose, no Open Graph image. `noindex` on top, so a
 * crawler that reaches the URL is asked to forget it.
 */
export function lockedMetadata(trip: Trip): Metadata {
  return {
    title: trip.title,
    description: undefined,
    robots: { index: false, follow: false },
    openGraph: undefined,
    twitter: undefined,
  };
}

/**
 * Why the gate is closed — "never let in" or "let in, then cut off".
 *
 * A password cookie is bound to the password hash it was issued against, so
 * changing the password invalidates every cookie at once. That is the scheme's
 * only revocation mechanism, and to the reader it is indistinguishable from
 * never having been let in: the same form, the same "this trip is private".
 * Somebody who has been reading a trip for two months and is suddenly asked
 * for a password concludes they are doing something wrong, and the answer they
 * need — *the password changed, ask for the new one* — is knowable here and
 * nowhere else, because only this side can see that a cookie was presented.
 *
 * A cookie that merely aged past TRIP_COOKIE_MAX_AGE fails verification the
 * same way, and gets the same message. That is deliberate: after ninety days
 * "ask for the password again" is the right instruction either way, and
 * splitting the two would mean telling the reader which of the server's
 * internal reasons applied.
 */
export async function tripLockReason(trip: Trip): Promise<"locked" | "stale"> {
  const jar = await cookies();
  return jar.get(tripCookieName(trip.ref)) ? "stale" : "locked";
}

/**
 * Whether this viewer may see the trip's money.
 *
 * `costsVisibility: guests` was parsed, typed, given a fail-closed default and
 * documented — and never consulted: `maySeeCosts` existed with no callers, so
 * a trip that declared its spending private published it in full. This is the
 * one call every costs-rendering path makes.
 */
export async function mayViewCosts(trip: Trip): Promise<boolean> {
  return maySeeCosts(trip, await isGuestOf(trip));
}

/**
 * True when the viewer has proved they belong here — used for costs.
 *
 * `costsVisibility: guests` finally means something for a person rather than
 * only for a password holder: an approved contact is a guest of the journal,
 * so the money on a trip they may read is theirs to see. It stays false for a
 * `private` trip whatever the journal let them into — being a guest of the
 * journal is not being on the trip, and this must never say yes about a trip
 * `mayReadTrip` says no about.
 */
export async function isGuestOf(trip: Trip): Promise<boolean> {
  // Somebody who took the trip has already seen what it cost.
  if (await isTravellerOn(trip)) return true;
  if (trip.visibility === "private") return false;
  if (await isJournalGuest(trip.username)) return true;
  if (isRestricted(trip)) {
    const jar = await cookies();
    return verifyTripToken(trip, jar.get(tripCookieName(trip.ref))?.value);
  }
  return false;
}

/**
 * Trips this viewer may see *listed*.
 *
 * Public trips, plus any restricted trip they have already unlocked. An
 * `unlisted` trip is deliberately absent: being reachable by link and being
 * advertised in a switcher are different things, and conflating them is how
 * "unlisted" quietly stops meaning anything.
 */
export async function listableTrips(trips: Trip[]): Promise<Trip[]> {
  const jar = await cookies();
  const session = await resolveSession(jar.get(GUEST_COOKIE)?.value, "guest");
  // One lookup for the whole list rather than one per trip: a grant is
  // journal-wide, so the answer cannot differ between two trips in it. Only
  // asked when somebody is signed in, and only for the journal they are signed
  // in to — the switcher renders on every page, including for strangers.
  const owner = session?.owner;
  const guest = owner !== undefined && (await isJournalGuest(owner));

  return trips.filter((trip) => {
    // `listed: false` is the old `unlisted` — reachable by link, never
    // advertised, not even to somebody who could open it.
    if (trip.visibility === "public") return trip.listed;
    // A trip you were on is listed for you: it is yours to find again.
    if (session?.owner === trip.username && isPersonOn(trip, session.email)) return true;
    // `private` is nobody else's, and a password cookie does not change that
    // — `mayReadTrip` refuses one before it ever looks at a cookie, so listing
    // it here would advertise a trip the switcher cannot open.
    if (trip.visibility === "private") return false;
    // A guest of the journal: the same question the panel on `/<user>/me` asks
    // and the same one the gate asks, so the switcher, the panel and the gate
    // name one set of trips between them (B41, B45).
    if (guest && owner === trip.username) return true;
    return verifyTripToken(trip, jar.get(tripCookieName(trip.ref))?.value);
  });
}
