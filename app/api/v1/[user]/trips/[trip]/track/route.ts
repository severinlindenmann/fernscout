import { authenticate, errorResponse, outOfScope, ownsUser } from "@/lib/api/auth";
import { SESSION_SCOPE } from "@/lib/auth";
import { deriveTripTrack } from "@/lib/gps/api";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * Drawing one trip's line from the store — B671, the second half of B665.
 *
 * Importing is the owner handing over their history; this is them deciding
 * that *this* trip's map may show where they went. Two calls, because they are
 * two decisions and the second one can be made years after the first — and
 * because everything between the store and the page happens here: clipping to
 * the trip's dates, cutting out the private zones, breaking the line at gaps.
 *
 * It answers with counts and never with a coordinate. What it writes is
 * `content/<user>/trips/<trip>/track.json`, which belongs to the trip and is
 * read behind the trip's own gate; deleting the store afterwards changes
 * nothing about it.
 *
 * **Owner only, and a trip-scoped token is refused** even for its own trip.
 * Deriving reads the owner's whole store across the trip's dates, and somebody
 * who came on the trip is not the person who decides what their host's
 * location history becomes.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/track">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip: tripId } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);
  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip. Deriving a track reads the owner's whole " +
          "location history across these dates, so it is theirs to run.",
      },
      { status: 403 },
    );
  }

  const trip = getTrip(tripRef(user, tripId));
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const result = deriveTripTrack(user, trip);

  if (!result.written) {
    return Response.json(
      {
        ...result,
        trip: trip.id,
        message:
          `Nothing in the store between ${trip.start} and ${trip.end}, so no line was ` +
          "written and any existing one was left alone. Import the export covering those " +
          `dates first: \`POST /api/v1/${user}/import\`.`,
      },
      { status: 200 },
    );
  }

  return Response.json({
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
