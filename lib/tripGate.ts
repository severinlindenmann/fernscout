import "server-only";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isOpenToLink, maySeeCosts } from "./access";
import { GUEST_COOKIE, resolveSession } from "./auth";
import { isJournalGuest, journalReader } from "./contacts/session";
import { isPersonOn, isPersonOnWith, redeemedTripsFor } from "./tripPeople";
import type { Trip } from "./types";

/**
 * Whether the current request may read this trip.
 *
 * **Every gated page must call this itself.** It is tempting to check once in
 * the route group's layout and treat the pages below as covered — that is what
 * this code did, and it leaked. A layout returning something other than
 * `children` changes what is *displayed*; it does not stop the page component
 * from running, and the page's data is serialised into the RSC payload and the
 * document's `<head>` either way. A closed trip was shipping its day index —
 * dates, locations, coordinates, per-day spend — plus JSON-LD for every day
 * and the day's own prose in `<meta name="description">`, to anybody who
 * opened the URL.
 *
 * So: pages return `null` when this says no (the layout draws the gate), and
 * `generateMetadata` returns `lockedMetadata` instead of the real thing.
 * Everything that lists or links trips filters separately — see lib/access.ts.
 */
export async function mayReadTrip(trip: Trip): Promise<boolean> {
  if (isOpenToLink(trip)) return true;

  // The people who took it are always let in, whichever way the trip is
  // closed. Somebody who was on the bus should not have to be invited back to
  // read their own week, and for a `private` trip they are the only way in.
  if (await isTravellerOn(trip)) return true;

  // `private` is the people who were there, and nobody else — not the people
  // the owner has let into the journal. It is the
  // one thing being a guest does not widen, and the reason there are three
  // visibility values rather than two: invite the family to the journal and
  // every non-public trip becomes theirs to read unless one word can hold a
  // trip back.
  if (trip.visibility === "private") return false;

  // `guest`: an invitation to the journal, and nothing else.
  //
  // `isJournalGuest` is the same call `resolveViewer` makes to decide what to
  // *list* on `/<user>/me`, so a trip shown there under "what you can read" is
  // a trip this returns true for. Before B41 the panel said yes and this said
  // no, and the reader met a password form for a password nobody had ever
  // sent them. B39 then removed the password, leaving this as the only door.
  //
  // **A session is not a key.** This is the only branch a signed-in reader can
  // reach that an anonymous one cannot, and it turns on a grant the owner
  // wrote — not on the reader having proved an address. Anyone can prove an
  // address; that is what makes `/api/auth/request` safe to answer `202` for
  // every address on earth. Put a `session !== null` test anywhere above this
  // line and every closed trip on the instance becomes readable by anyone with
  // an inbox. See `test/access-gate.test.ts`, "a signed-in stranger".
  return isJournalGuest(trip.username);
}

/**
 * Whether the signed-in reader took this trip.
 *
 * A guest session carries the address it was issued to, which is the same
 * address `people:` lists. The frontmatter was once the whole mechanism; since
 * B33 it is the first of two sources, the other being a buddy link the owner
 * issued and then approved. `isPersonOn` merges them, and this asks it exactly
 * one question so that a redeemed place and a typed-in name are the same
 * answer here.
 */
export async function isTravellerOn(trip: Trip): Promise<boolean> {
  const jar = await cookies();
  const session = await resolveSession(jar.get(GUEST_COOKIE)?.value, "guest");
  if (!session || session.owner !== trip.username) return false;
  return isPersonOn(trip, session.email);
}

/**
 * The only metadata a locked trip may emit — which is none of the trip's.
 *
 * It used to carry the trip's own title, on the reasoning that the gate says
 * which trip it is guarding and the browser tab should agree. B117 reversed
 * that. Trip ids are human-chosen and guessable by construction — `alps-2024`,
 * `japan-2027` — and the journal name is public, so the title was readable by
 * anyone willing to try a short dictionary against a URL. A private trip's
 * title is often the sensitive part of it: a surname, a place that says who
 * was there, `Divorce trip 2026`.
 *
 * The asymmetry settled it. A reader who signs in and is *still* refused has
 * never been told the title — the gate answers "this trip is not shared with
 * you" — so the site was naming the trip only to the reader who had proved
 * nothing at all. Both cannot be right, and `visibility` fails closed
 * everywhere else it is read.
 *
 * Omitting `title` rather than inventing one lets the journal layout's own
 * default stand, so the tab reads the journal's public name. Nothing else
 * either: no day title, no description drawn from the day's prose, no Open
 * Graph image. `noindex` on top, so a crawler that reaches the URL is asked to
 * forget it.
 *
 * Takes no trip on purpose. A function that is never handed the title cannot
 * be edited into leaking it again.
 */
export function lockedMetadata(): Metadata {
  return {
    description: undefined,
    robots: { index: false, follow: false },
    openGraph: undefined,
    twitter: undefined,
  };
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
 * `costsVisibility: guests` means an approved contact of the journal, or
 * somebody who was on the trip: the money on a trip they may read is theirs
 * to see. It stays false for a
 * `private` trip whatever the journal let them into — being a guest of the
 * journal is not being on the trip, and this must never say yes about a trip
 * `mayReadTrip` says no about.
 */
export async function isGuestOf(trip: Trip): Promise<boolean> {
  // Somebody who took the trip has already seen what it cost.
  if (await isTravellerOn(trip)) return true;
  if (trip.visibility === "private") return false;
  return isJournalGuest(trip.username);
}

/**
 * Trips this viewer may see *listed*.
 *
 * Public trips, plus the journal's `guest` trips once its owner has let this
 * reader in. An `unlisted` trip is deliberately absent: being reachable by link and being
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
  // The trips this reader holds a redeemed place on, in one query rather than
  // one per trip — the switcher renders on every page.
  const redeemed = owner === undefined ? new Set<string>() : await redeemedTripsFor(owner, session?.email);

  return trips.filter((trip) => {
    // `listed: false` is the old `unlisted` — reachable by link, never
    // advertised, not even to somebody who could open it.
    if (trip.visibility === "public") return trip.listed;
    // A trip you were on is listed for you: it is yours to find again.
    if (session?.owner === trip.username && isPersonOnWith(trip, session.email, redeemed)) return true;
    // `private` is nobody else's — not even a guest of the journal's, which
    // `mayReadTrip` refuses before it asks anything else. Listing it here
    // would advertise a trip the switcher cannot open.
    if (trip.visibility === "private") return false;
    // A guest of the journal: the same question the panel on `/<user>/me` asks
    // and the same one the gate asks, so the switcher, the panel and the gate
    // name one set of trips between them (B41, B45).
    return guest && owner === trip.username;
  });
}

/**
 * Who the gate thinks is asking, for the page that has to explain why it is
 * shut.
 *
 * Two sentences, not one, and telling them apart is the whole point. Somebody
 * with no session needs the sign-in form. Somebody *already signed in* who
 * still may not read this trip needs to be told exactly that — a guest of the
 * journal meeting a `private` trip, or a reader signed in with the wrong
 * address. Show them the form again and they will sign in a second time, get
 * the same page, and conclude the site is broken.
 *
 * Returns the address on the session **for this journal**, or null. It never
 * says whether that address may read anything; `mayReadTrip` is the only
 * answer to that, and this is called after it has already said no.
 */
export async function signedInAs(username: string): Promise<string | null> {
  return (await journalReader(username)).email;
}
