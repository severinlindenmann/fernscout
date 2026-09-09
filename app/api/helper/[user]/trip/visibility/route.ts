import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { patchTripVisibility } from "@/lib/api/tripVisibility";
import { getTrip, tripRef } from "@/lib/trips";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * `set_visibility`'s own door — B933's mistake, made again on a trip that
 * already exists.
 *
 * A separate route from `../route.ts`, not a second body on it: `PATCH
 * /api/v1/<user>/trips/<trip>/visibility` is already its own door in the
 * contract, for a reason worth keeping intact here too — widening who may
 * read a trip is a different kind of change from renaming it, and
 * `patchTripVisibility`'s own warning (`result.widened`) belongs to the call
 * that can cause it rather than to one that might also be renaming the trip
 * in the same breath.
 *
 * Cookie only, owner only, outside `/api/v1` — the same door as every other
 * route in this family; see `../route.ts` for the whole of that reasoning.
 */

const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/trip/visibility">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-trip-visibility", clientIp(request), LIMIT);
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
    refused(user, "set_visibility", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const result = patchTripVisibility(ref, { visibility: body.visibility });
  if (!result.ok) {
    refused(user, "set_visibility", result.error);
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  wrote(user, "set_visibility", { trip: ref, visibility: result.visibility });
  return Response.json({
    ok: true,
    trip: ref,
    visibility: result.visibility,
    listed: result.listed,
    teaser: result.teaser,
  });
}
