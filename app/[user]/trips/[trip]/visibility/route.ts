import { patchTripVisibility } from "@/lib/api/tripVisibility";
import { isOwner } from "@/lib/contacts/session";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * A trip's own `visibility:` and `listed:`, from the day where an owner is
 * standing — B980 round 3.
 *
 * `PATCH /api/v1/<user>/trips/<trip>/visibility` has done this since B396,
 * and — the same story as `.../day/[slug]/edit/route.ts` and
 * `.../day/[slug]/unpublish/route.ts` beside this file — a browser cannot
 * call it, because `/api/v1` reads `Authorization: Bearer` and nothing else.
 * This is that same door, opened for a cookie:
 *
 * - **Not under `/api/v1/`.**
 * - **The owner's cookie only.** A bearer token, trip-scoped or not, is
 *   refused before it is even read — the same refusal `patchTripVisibility`'s
 *   own route gives a trip-scoped token, made unnecessary here because no
 *   bearer token gets this far at all.
 * - **The same writer**, `patchTripVisibility`, so a change made from this
 *   panel and one an agent makes are checked and written identically —
 *   `listed: true` on a trip that is not `public` is refused here exactly as
 *   it is over the API (B51).
 */
const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent changes a trip's visibility " +
    "with PATCH /api/v1/<user>/trips/<trip>/visibility.",
};

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/[user]/trips/[trip]/visibility">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  if (!getTrip(ref)) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = patchTripVisibility(ref, body);
  if (!result.ok) {
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  return Response.json({
    ok: true,
    visibility: result.visibility,
    listed: result.listed,
    teaser: result.teaser,
  });
}
