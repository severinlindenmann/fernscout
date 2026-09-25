// GET /api/v2/{user}/gps — B1843 addendum, 2026-09-24.
//
// The raw location history's own months, for an agent holding the journal's
// own token (`requireJournalOwner` refuses a trip-scoped one, the same gate
// `.../owner/tel` uses — a location history covers every day of somebody's
// life, not the days one trip's token was there for).
//
// **Names months, never a fix.** `GET` answers with which `YYYY-MM` files
// exist. Never a coordinate — see `lib/gps/store.ts`'s own doc comment and
// `test/gps-store.test.ts`'s import graph assertion, which this route does
// not touch.
//
// `gpsPurgeRequest` is what the *cookie* door takes
// (`app/api/helper/[user]/gps/route.ts`) — the real purge is the owner's own
// browser act; `DELETE /api/v2/{user}/gps` always refuses (security review,
// 2026-09-24), so there is no `gpsPurgeDoc` response shape to document here
// any more.
import { z } from "zod";

export const gpsMonthsDoc = z.strictObject({
  /** `YYYY-MM`, sorted — the months this journal's history currently holds. */
  monthsHeld: z.array(z.string()),
});
export type GpsMonthsDoc = z.infer<typeof gpsMonthsDoc>;

const monthString = z.string().regex(/^\d{4}-\d{2}$/, "Must be YYYY-MM, e.g. \"2026-06\".");

/** Exactly one of "these named months" or "everything" — never both, and
 * never neither, so a purge is never accidentally a no-op or unbounded. */
export const gpsPurgeRequest = z.union([
  // 600 months is fifty years — well past any journal this store could hold
  // and a real ceiling rather than an unbounded array a caller could pad.
  z.strictObject({ months: z.array(monthString).min(1).max(600) }),
  z.strictObject({ all: z.literal(true) }),
]);
export type GpsPurgeRequest = z.infer<typeof gpsPurgeRequest>;
