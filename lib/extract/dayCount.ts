import type { DayGroup } from "./group";
import type { PhotoRow } from "@/lib/staging/manifest";

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

/**
 * The date a kept photograph actually belongs to — the person's own edit if
 * they made one, the camera's own reading otherwise, `undefined` when it has
 * neither. B1803 final review, finding 3.
 *
 * **This is the rule `lib/extract/commit.ts` commits by**, and it imports
 * this rather than keeping its own copy: `commitDay` moves exactly the
 * photographs `effectiveDate(p) === date` picks out, so any screen counting
 * them a different way is describing a different journal than the one on
 * disk. `ReadyScreen` used `photo.date` alone (missing every camera-dated
 * photograph) and `PreviewScreen` used the server's `takenAt` clustering
 * (missing every hand-dated one, and then calling it "not added" while it
 * sat in the journal). One rule, three callers.
 */
export function effectiveDate(photo: PhotoRow): string | undefined {
  return photo.date ?? photo.takenAt?.slice(0, 10);
}

/** Every kept photograph of one day, in manifest order — what `commitDay`
 *  moved, or is going to. */
export function photosForDate(photos: PhotoRow[], date: string): PhotoRow[] {
  return photos.filter((p) => !p.dropped && effectiveDate(p) === date);
}

/** Every kept photograph that still has no date at all, from either source —
 *  the ones no commit can ever have moved, which is what "came with no date
 *  and weren't added either" is allowed to mean. */
export function undatedPhotos(photos: PhotoRow[]): PhotoRow[] {
  return photos.filter((p) => !p.dropped && effectiveDate(p) === undefined);
}
