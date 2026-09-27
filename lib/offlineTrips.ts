import type { TripStatus } from "./types";

/** The part of a trip `OfflineTrips` (B2463) needs to decide what "Save
 *  recent trips automatically" keeps, and what stays behind "Show more". */
export type OfflineTripMeta = { id: string; status: TripStatus; end: string };

/**
 * Which trips "Save recent trips automatically" keeps, and the same set
 * `OfflineTrips` always shows above the fold: every upcoming or current
 * trip, plus the two most recently finished ones. Pure so both the render
 * and the auto-keep effect (and this file's own test) agree on one answer
 * without a DOM, a worker or a clock — `end` sorts the past trips, and a
 * trip's own status is trusted over comparing dates to `Date.now()`, the
 * same call `getTrips` already made once.
 */
export function autoSaveTargets(trips: OfflineTripMeta[]): string[] {
  const upcomingOrCurrent = trips.filter((t) => t.status !== "past").map((t) => t.id);
  const recentPast = trips
    .filter((t) => t.status === "past")
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0))
    .slice(0, 2)
    .map((t) => t.id);
  return [...upcomingOrCurrent, ...recentPast];
}
