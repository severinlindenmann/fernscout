// GET /api/v2/{user}/trips/{trip}/media/duplicates — ports
// app/api/v1/[user]/trips/[trip]/media/duplicates/route.ts onto the v2
// plumbing. Domain logic (`findDuplicateMedia`) is unchanged.
import { mayWriteTrip } from "@/lib/api/auth";
import { outOfScopeRefusal, ownsUser, resolveBearer } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { findDuplicateMedia } from "@/lib/api/media";
import { getTrip, mediaWithOwner, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The same picture twice — B1103. Reports and never deletes: each group
 * comes back largest first, and the caller hands whichever copy the owner
 * does not want to `DELETE /api/v2/{user}/media`. See the v1 route this
 * replaces for the full reasoning on why this is `mayWriteTrip` rather than
 * the trip's own read gate.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/trips/[trip]/media/duplicates">,
) {
  const { user, trip } = await params;
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);
  const gate = await mayWriteTrip(bearer.session, found);
  if (!gate.ok) {
    return fail(
      "forbidden",
      "This token's access to this trip has been revoked. Ask the owner for a new one.",
      undefined,
      403,
    );
  }

  const groups = (await findDuplicateMedia(ref)).map((group) =>
    group.map((item) => ({ ...item, src: mediaWithOwner(item.src, user) })),
  );

  return ok({
    ok: true,
    groups,
    note:
      groups.length === 0
        ? "No photograph on this trip looks like another one on it."
        : `${groups.length} group${groups.length === 1 ? "" : "s"} of photographs that look like ` +
          "the same picture. Largest first inside each group — usually the copy to keep, but " +
          "that is the owner's call, not this endpoint's. Ask which one they want, then remove " +
          "the other with DELETE .../media. A resemblance is a guess: two frames of one burst " +
          "are different photographs and can land here too.",
  });
}
