import "server-only";
import { getTrips } from "@/lib/trips";
import { getUser } from "@/lib/users";

/**
 * "A new trip" — B1821, spec §7.2.
 *
 * The one server read this flow needs before it ever asks anything: the
 * existing trips, with the dates and the status `lib/trips.ts` already
 * derived for them. Nothing else about the flow reads the filesystem — the
 * create itself goes through `POST /api/helper/[user]/trip`, the same route
 * `create_trip` already writes through (B685), so a trip made from this page
 * is a trip made any other way.
 *
 * `existingTrips` exists for exactly one thing: T3!, the overlapping-dates
 * notice. `NewTripFlow` already knows the trip it is about to create (the
 * title and the two dates it just gathered), so before it writes it can ask,
 * client-side, whether any trip in this list is *also* `status: "current"` —
 * the same status `loadTrips()` (`lib/trips.ts`) has already resolved down to
 * at most one, resolving the tie in favour of the later `start`. This is a
 * notice about *today*, not a control, so nothing here is written back — see
 * `NewTripFlow.tsx`'s own doc comment.
 */
export type ExistingTripSummary = { id: string; title: string; start: string; end: string; status: string };

export function existingTripsForNewTrip(username: string): ExistingTripSummary[] {
  return getTrips(username).map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end, status: t.status }));
}

/** The journal's other languages, never the default. Only whether there are
 *  any matters at creation (B2846): the create route is told `translations:
 *  "none"` for a multi-language journal, exactly as when the owner skipped it. */
export function otherLocalesForNewTrip(username: string): string[] {
  const journal = getUser(username);
  return journal ? journal.locales.filter((l) => l !== journal.defaultLocale) : [];
}

/** B2849 - a new trip reads "guest" unless the journal asks search engines to list it. */
export function defaultTripVisibility(journalVisibility: string | undefined): "guest" | "public" {
  return journalVisibility === "public" ? "public" : "guest";
}
