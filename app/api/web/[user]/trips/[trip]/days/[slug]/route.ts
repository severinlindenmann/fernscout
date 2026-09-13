// PATCH /api/web/{user}/trips/{trip}/days/{slug} — the owner correcting
// their own day, from a cookie — B1595 (v2 migration, phase 2 step 5), and
// the door B980 built for exactly this.
//
// `PATCH /api/v2/{user}/trips/{trip}/days/{slug}` takes a bearer token, and a
// browser must never hold one (decision 24). This is the cookie-side door:
// `isOwner` on the cookie only — any `Authorization` header is refused
// outright — and then `applyDayPatch`, the exact function the v2 route calls
// after its own trip-write gate, in process. No bearer token is minted,
// held, or sent anywhere for this call.
//
// Replaces `app/[user]/trips/[trip]/day/[slug]/edit/route.ts`, which wrote
// through v1's `editEntry` against the pre-B1598 file shape and a flat
// `captions`/`photoVisibility` vocabulary v2 retired in favour of `media`
// array items each carrying their own `caption`/`visibility` (owner review,
// 2026-09-12) — `components/EditDay.tsx` builds that array now.
import { applyDayPatch } from "@/app/api/v2/[user]/trips/[trip]/days/[slug]/route";
import { readTripFile } from "@/lib/api/v2/store";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent corrects a day with " +
    "PATCH /api/v2/{user}/trips/{trip}/days/{slug}.",
};

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/days/[slug]">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip: tripId, slug } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const trip = readTripFile(user, tripId);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  return applyDayPatch(user, tripId, slug, trip, request);
}
