import "server-only";
import { redirect } from "next/navigation";
import { getCurrentTrip } from "./trips";
import type { Trip } from "./types";

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
export function currentTripOrRedirect(username: string): Trip {
  const trip = getCurrentTrip(username);
  if (!trip) redirect(`/${username}/trips`);
  return trip;
}
