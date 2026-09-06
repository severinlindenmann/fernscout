import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { patchTripDetails } from "@/lib/api/tripDetails";
import { patchTripVisibility } from "@/lib/api/tripVisibility";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `PATCH /api/trip` — what a journey is called, when it ran, and who may read
 * it, changed by the person who owns it. B621.
 *
 * The cookie-side door, the same shape as `/api/journal` next to it: the owner
 * standing on their own page holds a session, not a bearer token, and
 * `resolveSession` refuses to swap the two. What it writes is not new
 * behaviour for an agent — `.../trips/{trip}/visibility` has taken visibility
 * since B396 — except for the four `patchTripDetails` covers, which nothing
 * anywhere could write until now.
 *
 * ## Two kinds of change, two calls
 *
 * A body naming `visibility` alongside a detail is refused rather than
 * half-applied, the rule `PATCH /api/v1/{user}/config` already follows for
 * `features` and a profile field: each call rewrites `trip.md` whole, so a
 * request doing it twice is a request that can succeed halfway.
 *
 * It also happens to be the right shape for the page. Widening who may read a
 * journey is not a field you edit alongside a typo in its title — it opens
 * everything already published on it to a broader audience, so the form asks
 * for it separately and shows the sentence `patchTripVisibility` returns
 * before it happens.
 */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const trip = typeof body.trip === "string" ? body.trip : "";

  if (!getUser(username)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!isEnabled("auth", username)) {
    // No sign-in, no cookie session, so there is nobody who could be the
    // owner here — a 404 rather than a 403, matching every other surface
    // gated on a capability this journal does not have.
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (!(await isOwner(username, request))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const ref = tripRef(username, trip);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const DETAILS = ["title", "tagline", "start", "end"] as const;
  const named = DETAILS.filter((field) => body[field] !== undefined);
  const wantsVisibility = body.visibility !== undefined;

  if (wantsVisibility && named.length > 0) {
    return Response.json(
      {
        error: "mixed_change",
        message:
          `Send visibility and ${named.join(", ")} as two calls. Each one rewrites trip.md ` +
          `whole, and a request doing that twice is a request that can succeed halfway. ` +
          `Nothing was changed.`,
      },
      { status: 400 },
    );
  }

  if (wantsVisibility) {
    const result = patchTripVisibility(ref, { visibility: body.visibility });
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
      widened: result.widened,
    });
  }

  if (named.length === 0) {
    return Response.json({ error: "nothing_to_change" }, { status: 400 });
  }

  const result = patchTripDetails(ref, body);
  if (!result.ok) {
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }
  return Response.json({
    ok: true,
    title: result.title,
    tagline: result.tagline,
    start: result.start,
    end: result.end,
  });
}
