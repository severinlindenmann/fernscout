// POST .../days/{slug}/unpublish — B1612 (phase 2 step 3, parcel B).
//
// The mirror of publish (content.md §1): no body, no sends, same owner-only
// gate and same `out_of_scope` refusal for a trip-scoped token.
import { fail, ok } from "@/lib/api/v2/route";
import { resolveBearer, ownsUser } from "@/lib/api/v2/auth";
import { mayActAsOwner, mayWriteTrip, refuseWrite } from "@/lib/api/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readTripFile, readDayFile, writeDayFile } from "@/lib/api/v2/store";
import type { Trip } from "@/lib/types";

export const dynamic = "force-dynamic";

function tripLike(user: string, tripId: string, people: { name: string; email: string }[]): Trip {
  return { username: user, id: tripId, ref: `${user}/${tripId}`, people } as unknown as Trip;
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/trips/[trip]/days/[slug]/unpublish">,
) {
  const { user, trip: tripId, slug } = await params;

  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) {
    return fail("out_of_scope", ERROR_CODES.out_of_scope, undefined, 403);
  }

  const trip = readTripFile(user, tripId);
  if (!trip) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);

  const gate = await mayWriteTrip(bearer.session, tripLike(user, tripId, trip.people));
  if (!gate.ok) return refuseWrite(gate);

  if (!mayActAsOwner(bearer.session, user)) {
    return fail(
      "out_of_scope",
      "This token is scoped to one trip, so it can write days into that trip — including this " +
        "one — but it cannot take one off the site. Only the journal's owner decides what is on it.",
      undefined,
      403,
    );
  }

  return applyUnpublish(user, tripId, slug);
}

/**
 * The write itself, factored out of `POST` above so
 * `/api/web/[user]/trips/[trip]/days/[slug]/unpublish` (the owner's cookie
 * proxy, B1595) can reach the same writer without a bearer token ever
 * existing — nothing is minted for the browser to hold, and this is a
 * direct, in-process call, never an HTTP round trip. Everything above this
 * point is the owner-only bearer gate; nothing below ever looked at
 * `session`.
 */
export async function applyUnpublish(user: string, tripId: string, slug: string): Promise<Response> {
  const day = readDayFile(user, tripId, slug);
  if (!day) return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);
  if (day.status !== "published") {
    return fail(
      "already_draft",
      `"${slug}" is not on the site, so there was nothing to take down. Nothing was changed.`,
      undefined,
      409,
    );
  }

  writeDayFile(user, tripId, slug, { ...day, status: "draft" });
  // B2202 rework: nothing to prune here any more. `track.json` now holds
  // every trip date regardless of publish state; what a reader is actually
  // drawn is filtered at serve time (`readerTrack`, `lib/gps/track.ts`) from
  // the entry list this request already narrowed, so this date stops being
  // drawn the moment it stops being a published entry — no file write needed.
  return ok({ ok: true, slug, status: "draft", note: `"${slug}" is off the site. Publishing it again is the undo.` });
}
