import { resolveTripOwner } from "@/lib/api/tripParty";
import { patchTripTracks, readTripTracks } from "@/lib/api/tripTracks";
import { TRACK_ROWS, TRACKS } from "@/lib/tracks";

export const dynamic = "force-dynamic";

const REFUSAL =
  "This token is scoped to one trip, so it can write days into that trip, but it cannot " +
  "change what the trip asks those days for. A token that could lower the bar it is measured " +
  "against is not a bar — only the journal's owner can say what a journey is keeping.";

/**
 * What this trip keeps track of — B531, and `docs/plans/W40-what-a-day-owes.md`.
 *
 * Worth reading before the first day is written rather than after the first
 * refusal, which is why the trip create response and `GET .../trips` carry it
 * too.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/tracks">,
) {
  const { user, trip } = await params;
  const resolved = await resolveTripOwner(request, user, trip, REFUSAL);
  if (!resolved.ok) return resolved.response;
  const tracks = readTripTracks(resolved.ref)!;
  return Response.json({
    trip: resolved.ref,
    tracks,
    asks: Object.fromEntries(
      TRACKS.filter((key) => tracks[key]).map((key) => [
        key,
        `Every day is asked for ${TRACK_ROWS[key].keeps.replace(/^what it /, "")}. ` +
          `A day that has none says so: ${TRACK_ROWS[key].decline}`,
      ]),
    ),
  });
}

/**
 * Turn a row off, or back on. Only the rows you name change.
 *
 * The call an owner reaches for half way through a journey, when they have
 * decided they are not going to keep logging what everything cost and every
 * day they write is being refused for it.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/tracks">,
) {
  const { user, trip } = await params;
  const resolved = await resolveTripOwner(request, user, trip, REFUSAL);
  if (!resolved.ok) return resolved.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body) || !("tracks" in body)) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          `Send {"tracks": {"costs": false}}. The rows are ${TRACKS.join(", ")}; only the ` +
          `ones you name change, and every row is on unless it has been turned off.`,
      },
      { status: 400 },
    );
  }

  const result = patchTripTracks(resolved.ref, body.tracks);
  if (!result.ok) {
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  return Response.json({
    ok: true,
    trip: resolved.ref,
    tracks: result.tracks,
    note:
      (result.turnedOff.length
        ? `Days written into this trip are no longer asked for ${result.turnedOff.join(" or ")}. ` +
          `Nothing already written changes, and nothing is deleted — a day that recorded its ` +
          `costs still shows them. `
        : "") +
      (result.turnedOn.length
        ? `Days written from now on are asked for ${result.turnedOn.join(" and ")}, and one that ` +
          `has none has to say so in the call. Days already on the site are not revisited; a ` +
          `draft is, the next time you try to publish it. `
        : "") +
      "This is what the trip asks for, not what it already holds.",
  });
}
