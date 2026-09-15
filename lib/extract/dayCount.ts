import type { DayGroup } from "./group";

/**
 * How many *days* a run's groups represent — B1803 Phase 2 fix round 1.
 *
 * The undated group is real work (the board still shows a card for it) but
 * it is not a day: nobody can be told "day N of M" against a group with no
 * date, and `FoundStep` already promises a day count before the board ever
 * renders ("See my {days} days"). Both screens call this rather than each
 * filtering `.undated` on its own, which is what let them drift — `FoundStep`
 * excluded it and `DayBoard` did not, so a run with any undated photograph
 * showed two different day counts a screen apart.
 *
 * **Its own file, not `lib/extract/group.ts`.** Both callers are client
 * components. `group.ts` imports `clusterMedia`, which imports `distanceKm`
 * from `lib/ingest/geo.ts`, which imports `node:fs` — fine on the server,
 * fatal in a browser bundle. A `type`-only import of `DayGroup` was erased
 * before bundling and never pulled that graph in; a real value import from
 * the same module is not erased, and Turbopack refused the build outright
 * ("the chunking context does not support external modules (request:
 * node:fs)") the first time this function lived next to `groupIntoDays`
 * instead. This file imports nothing but the type.
 */
export function countDays(groups: DayGroup[]): number {
  return groups.filter((g) => !g.undated).length;
}
