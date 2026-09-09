import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { patchTripTracks } from "@/lib/api/tripTracks";
import { getTrip, tripRef } from "@/lib/trips";
import { TRACKS } from "@/lib/tracks";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * `trip_tracks`'s own door — what a trip asks every day for, changed from the
 * conversation instead of `PATCH /api/v1/<user>/trips/<trip>/tracks`, which a
 * hosted owner has no bearer token in a browser to call (see `../route.ts`
 * for why every route in this family is cookie-only).
 *
 * `patchTripTracks` only changes the rows it is sent; this always sends all
 * three, because the card shows all three as a toggle each and a press
 * reflects exactly what was on the screen.
 */

const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/trip/tracks">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-trip-tracks", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const ref = tripRef(user, text(body.trip));
  if (!getTrip(ref)) {
    refused(user, "trip_tracks", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const tracks: Record<string, boolean> = {};
  for (const row of TRACKS) {
    const said = body[row];
    if (said === "true" || said === true) tracks[row] = true;
    else if (said === "false" || said === false) tracks[row] = false;
  }

  const result = patchTripTracks(ref, tracks);
  if (!result.ok) {
    refused(user, "trip_tracks", result.error);
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  wrote(user, "trip_tracks", { trip: ref, tracks: result.tracks });
  return Response.json({ ok: true, trip: ref, tracks: result.tracks });
}
