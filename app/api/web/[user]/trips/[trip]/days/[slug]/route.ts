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
import { readJson } from "@/lib/api/v2/route";
import { readTripFile } from "@/lib/api/v2/store";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * What the panel can actually draw — and the route accepts nothing else.
 *
 * Carried over from the v1 route this replaces, because the reason was never
 * about v1: **a field nobody can type is a field this route has no business
 * accepting.** There is no CMS here (decision 24), and `EditDay` is a
 * correction to a day somebody already has rather than a form that composes
 * one. The allowlist is what keeps that architectural, instead of a promise
 * the next page to grow an input can quietly break.
 *
 * It cannot publish or unpublish either, and that needs no entry here:
 * `status` is server-owned and absent from `dayPatch` altogether, so a day
 * moves on and off the site only through its own door (B28, B266).
 *
 * B1586 is why this list is checked against the panel rather than trusted:
 * it stopped following `EditDay` when the panel grew a caption box, and the
 * two missing fields were refused for four days while the panel offered them.
 * If you add an input, add it here in the same change.
 */
const EDITABLE = [
  "title",
  "time",
  "content",
  "location",
  "date",
  "visibility",
  "translations",
  "media",
  "declined",
] as const;

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

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const offered = Object.keys(body.value as Record<string, unknown>);
  const unknown = offered.filter((key) => !(EDITABLE as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return Response.json(
      {
        error: "not_editable_here",
        message:
          `This door writes only what the edit panel draws: ${EDITABLE.join(", ")}. ` +
          `It was sent ${unknown.join(", ")}. An agent changes the rest with ` +
          `PATCH /api/v2/{user}/trips/{trip}/days/{slug}.`,
      },
      { status: 400 },
    );
  }

  return applyDayPatch(user, tripId, slug, trip, new Request(request.url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body.value),
  }));
}
