// PATCH /api/web/{user}/trips/{trip} — the owner correcting a trip's own
// details, from a cookie — B1595 (v2 migration, phase 2 step 5).
//
// `PATCH /api/v2/{user}/trips/{trip}` takes a bearer token, and a browser
// must never hold one (decision 24). This is the cookie-side door: `isOwner`
// on the cookie only — any `Authorization` header is refused outright — and
// then `applyTripPatch`, the exact function the v2 route calls after its own
// bearer check, in process. No bearer token is minted, held, or sent
// anywhere for this call.
//
// v2 folded a trip's `visibility`/`listed`/`teaser` into the trip document
// itself, so this same door is also where those move — see
// `.../visibility/route.ts` beside this file, a narrower door onto the same
// writer for the panel that only ever asks about audience.
//
// Replaces `app/api/trip/route.ts`, which wrote through v1's
// `patchTripDetails`/`patchTripVisibility` against the pre-B1598 file shape.
import { applyTripPatch } from "@/app/api/v2/[user]/trips/[trip]/route";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message: "This is the owner's own door, from a browser. An agent edits a trip with PATCH /api/v2/{user}/trips/{trip}.",
};

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip } = await params;
  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  return applyTripPatch(user, trip, journal, request);
}
