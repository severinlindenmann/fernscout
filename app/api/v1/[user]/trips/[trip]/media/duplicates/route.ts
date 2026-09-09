import { authenticate, errorResponse, mayWriteTrip, outOfScope, ownsUser, refuseWrite } from "@/lib/api/auth";
import { findDuplicateMedia } from "@/lib/api/media";
import { getTrip, mediaWithOwner, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/<user>/trips/<trip>/media/duplicates` — the same picture twice.
 *
 * B1103. `POST .../media` says so as a photograph arrives and stores it
 * anyway, which is right — a resemblance is a guess and a dropped photograph
 * is unrecoverable. But nothing asked the question afterwards, so a trip
 * carrying eleven second copies looked exactly like one carrying none, and the
 * only way to find out was for a person to scroll a gallery.
 *
 * It reports and never deletes: each group comes back largest first, and the
 * caller hands whichever copy the owner does not want to `DELETE .../media`.
 * Which of two copies a journal keeps is an editorial decision, and that is
 * the second call's job — ask, in words, before making it.
 *
 * Behind `mayWriteTrip` rather than the trip's own gate: it names held-back
 * photographs (B596) and the bytes of files a reader is only ever shown one at
 * a time, and nobody who cannot edit the trip has anything to do with it.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/media/duplicates">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  const groups = (await findDuplicateMedia(ref)).map((group) =>
    group.map((item) => ({ ...item, src: mediaWithOwner(item.src, user) })),
  );

  return Response.json({
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
