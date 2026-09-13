// POST /api/web/{user}/trips/{trip}/days/{slug}/unpublish — taking a day off
// the site, from a cookie — B1595 (v2 migration, phase 2 step 5), the other
// half of B980's "correct or take down".
//
// `POST /api/v2/{user}/trips/{trip}/days/{slug}/unpublish` takes a bearer
// token, and a browser must never hold one (decision 24). This is the
// cookie-side door: `isOwner` on the cookie only — any `Authorization`
// header is refused outright — and then `applyUnpublish`, the exact function
// the v2 route calls after its own owner-only bearer gate, in process. No
// bearer token is minted, held, or sent anywhere for this call.
//
// Replaces `app/[user]/trips/[trip]/day/[slug]/unpublish/route.ts`, which
// wrote through v1's `unpublishEntry` against the pre-B1598 file shape.
import { applyUnpublish } from "@/app/api/v2/[user]/trips/[trip]/days/[slug]/unpublish/route";
import { readDayFile, readTripFile } from "@/lib/api/v2/store";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent takes a day off the site with " +
    "POST /api/v2/{user}/trips/{trip}/days/{slug}/unpublish.",
};

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/days/[slug]/unpublish">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip: tripId, slug } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (!readTripFile(user, tripId)) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  if (!readDayFile(user, tripId, slug)) {
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }

  return applyUnpublish(user, tripId, slug);
}
