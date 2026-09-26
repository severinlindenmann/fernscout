// POST /api/v2/{user}/trips/{trip}/track — B1734, ports
// app/api/v1/[user]/trips/[trip]/track/route.ts onto the v2 plumbing.
// Domain logic (`deriveTripTrack`) is unchanged.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { deriveTripTrack } from "@/lib/gps/api";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * Drawing one trip's line from the store — B671, the second half of B665.
 *
 * Importing is the owner handing over their history; this is them deciding
 * that *this* trip's map may show where they went. It answers with counts and
 * never with a coordinate. What it writes is
 * `content/<user>/trips/<trip>/track.json`, which belongs to the trip and is
 * read behind the trip's own gate; deleting the store afterwards changes
 * nothing about it.
 *
 * **Owner only, and a trip-scoped token is refused** even for its own trip —
 * `requireJournalOwner` is exactly this gate, because deriving reads the
 * owner's whole store across the trip's dates, and somebody who came on the
 * trip is not the person who decides what their host's location history
 * becomes. This is one of the two v1 routes the v2 migration kept: it is not
 * a document like the ones every other door replaced, and moved here rather
 * than staying behind at `/api/v1`, which is retired (B1734).
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/trips/[trip]/track">,
) {
  const { user, trip: tripId } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const trip = getTrip(tripRef(user, tripId));
  if (!trip) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);

  const result = deriveTripTrack(user, trip);

  if (!result.written) {
    return ok({
      ...result,
      trip: trip.id,
      message:
        `Nothing left to draw between ${trip.start} and ${trip.end} — the store has no fixes ` +
        "for those dates, or every one was trimmed away — so no line was written, and any " +
        "existing one for this trip was removed rather than left stale. Import the export " +
        `covering those dates first: \`POST /api/v2/${user}/import\`.`,
    });
  }

  return ok({
    ...result,
    trip: trip.id,
    message:
      `${result.segments} segments, ${result.points} points. The trip's map draws it under ` +
      "the day markers. A break between segments is a gap in the data — a flight, a dead " +
      "battery — and is left as a gap rather than joined.",
    next:
      result.zones === 0
        ? "No private zones are set. If this trip started or ended at home, the line starts " +
          `at your front door: put \`[{"label":"home","lat":…,"lon":…,"radiusM":500}]\` in ` +
          "`content/<user>/gps/exclude.json` and run this again."
        : `${result.zones} private zones were cut out before the line was written.`,
  });
}
