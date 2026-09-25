import "server-only";
import { getCurrentTrip, getTrip, tripRef } from "@/lib/trips";
import type { Trip } from "@/lib/types";

/**
 * "Who may read this trip" — B1833, spec §7.6.
 *
 * D4: the trip page keeps its own visibility control and deep-links this
 * flow at step one with the trip already chosen — this is that resolution,
 * shared by the flow's own page. `?trip=<id>` names it; with none given, the
 * current trip stands in, the same fallback `lib/studio/day.ts`'s own
 * `proposeAddDayTrip` already uses for "which day".
 */
export function tripForVisibilityFlow(username: string, tripId: string | null): Trip | undefined {
  if (tripId) return getTrip(tripRef(username, tripId));
  return getCurrentTrip(username);
}
