import "server-only";
import { redirect } from "next/navigation";
import { mayReadTrip } from "./tripGate";
import { getCurrentTrip, getTrips } from "./trips";
import type { Trip } from "./types";

import { journalPath } from "./journalPath";
/**
 * The trip the bare URLs show — `/<user>`, `/<user>/gallery`, `/<user>/map`,
 * `/<user>/costs` — or a redirect to the trip list when there is none.
 *
 * Having no current trip is a normal state, not a missing page: a new journal
 * has no trips at all, and one whose trips are all `upcoming` is simply not
 * under way yet. All four URLs used to answer 404, so a journal created
 * through the API was born broken and its owner's first act was to look at a
 * page that said it did not exist.
 *
 * `/<user>` was fixed on its own and the other three were left answering 404
 * (B73), which is why the resolution lives here rather than four times over:
 * `SiteNav` renders the same four links from one list, and they have to fail
 * the same way or not at all.
 *
 * `/<user>/trips` is the honest destination — it is where the journal's
 * content actually is, and where an empty journal gets told so.
 */
export async function currentTripOrRedirect(username: string): Promise<Trip> {
  const trip = await currentTripFor(username);
  if (!trip) redirect(`${journalPath(username)}/trips`);
  return trip;
}

/**
 * B2469 — the trip the bare URLs show **to this viewer**: the one
 * `getCurrentTrip` would pick (the current trip, else the newest past one),
 * but among the trips this viewer may read. A journal whose newest trip is
 * private used to greet every guest — one following a bookmark, a forwarded
 * link, the welcome guide — with "This trip is closed to its travellers
 * only", although older trips were open to them.
 *
 * When the viewer may read none of them, the answer is the unfiltered pick,
 * so the gate in `(trip)/layout.tsx` still stands in front of it and offers a
 * stranger the way to ask for access; nothing is shown that was not before.
 */
export async function currentTripFor(username: string): Promise<Trip | undefined> {
  const trips = getTrips(username);
  const inOrder = [...trips.filter((t) => t.status === "current"), ...trips.filter((t) => t.status === "past")];
  for (const trip of inOrder) {
    if (await mayReadTrip(trip)) return trip;
  }
  return getCurrentTrip(username);
}
