import type { Session } from "@/lib/auth";
import { listDrafts } from "@/lib/api/entries";
import { writableTrips } from "@/lib/api/auth";
import { getTrips } from "@/lib/trips";

/**
 * `draftQueue` — the queue an agent's `/status` view is built from — B91.
 *
 * v1's own whole-response assembler (`journalStatus`) was retired under
 * B1632 along with the route it answered, `GET /api/v1/{user}/status`;
 * `lib/api/v2/status.ts`'s `buildJournalStatus` is v2's equivalent, over the
 * v2 document shape. `draftQueue` itself outlived both: the v1 `/drafts`
 * route it was originally extracted from is already gone (an earlier
 * ticket), and `test/test-content.test.ts` now calls it directly to keep
 * the drafts-shape property covered without any route in between.
 */

export type DraftRow = {
  slug: string;
  title: string;
  date: string;
  test?: true;
  trip: string;
  publish: string;
};

/**
 * Everything waiting for a person to approve it, scoped to what this token may
 * reach.
 *
 * Extracted from `app/api/v1/[user]/drafts/route.ts` so that route and
 * `/status` cannot disagree about the shape — an acceptance criterion of B91,
 * and the reason is B134: `test` is inherited from the trip, so a second
 * hand-rolled draft list is a second chance to report invented content as
 * something somebody lived.
 *
 * A trip-scoped token sees its own trip's drafts and no others. That is
 * `writableTrips`, the same gate the drafts and trips routes apply — not a
 * rule reinvented here.
 */
export async function draftQueue(
  user: string,
  session: Session,
  base: string,
): Promise<DraftRow[]> {
  const trips = await writableTrips(session, getTrips(user));
  return trips.flatMap((trip) =>
    listDrafts(trip.ref).map((draft) => ({
      ...draft,
      trip: trip.ref,
      publish: `POST ${base}/api/v2/${user}/trips/${trip.id}/days/${draft.slug}/publish`,
    })),
  );
}
