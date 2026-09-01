import { authenticate, errorResponse, ownsUser } from "@/lib/api/auth";
import { SESSION_SCOPE } from "@/lib/auth";
import { DELETION_TTL_MINUTES, humanBytes, requestDeletion } from "@/lib/deletions";
import { tripTombstone } from "@/lib/tombstones";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * Delete a trip — or rather, ask to.
 *
 * The same gate as the journal endpoint beside it: this answers `202`, deletes
 * nothing, and mails the owner a link. See `app/api/v1/[user]/route.ts` for
 * why the confirmation is a mail rather than `lib/agentConfirm.ts`.
 *
 * One difference from deleting a day, and it is said out loud in the mail
 * rather than left to be discovered: **the trip takes its `media/` with it.**
 * A deleted day leaves its photographs on disk on purpose, so the same
 * pictures are still there to write a replacement around. A deleted trip has
 * nothing left to write them into.
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]">,
) {
  const { user, trip } = await params;

  // Answered before the token is even looked at. A journal deletion revokes
  // every session it had, so an agent retrying its own call would otherwise
  // read "invalid token" — which is true and useless — instead of "this is
  // gone". Nothing is disclosed by it: the trip's own page says the same.
  const stone = tripTombstone(user, trip);
  if (stone && !getTrip(tripRef(user, trip))) {
    return Response.json(
      {
        error: "gone",
        message: `"${trip}" was deleted on ${stone.deletedAt.slice(0, 10)}. There is nothing left to delete.`,
      },
      { status: 410 },
    );
  }

  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  /**
   * The owner, and nobody else — not even somebody on the trip.
   *
   * `mayWriteTrip` would pass a `write:trip:<id>` token here, and that is
   * exactly the check this must not use. Everyone in a trip's `people:` may
   * write to the whole trip; being able to add a day to somebody's honeymoon
   * is not a reason to be able to delete the honeymoon.
   */
  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip, so it can write days into that trip — including " +
          "this one — but it cannot delete it. Writing to a journey and removing it are not " +
          "the same authority. Only the journal's owner can delete a trip.",
      },
      { status: 403 },
    );
  }

  const asked = await requestDeletion(
    { kind: "trip", username: user, tripId: trip },
    { sessionId: auth.session.id },
  );
  if (!asked.ok) {
    return Response.json({ error: asked.error, message: asked.message }, { status: asked.status });
  }

  const { summary } = asked;
  return Response.json(
    {
      ok: true,
      deleted: false,
      status: "confirmation_sent",
      mailedTo: asked.email,
      expires: asked.expiresAt,
      willDelete: {
        trip: summary.title,
        id: trip,
        days: summary.days,
        files: summary.files,
        size: humanBytes(summary.bytes),
        mediaGoesToo: true,
      },
      note:
        "NOTHING HAS BEEN DELETED. A mail has gone to the address that owns this journal " +
        `(${asked.email}) with a link to a page that asks once more and has a button on it. ` +
        `The link works for ${DELETION_TTL_MINUTES} minutes and once only. Unlike deleting a ` +
        "day, deleting a trip takes its photographs with it — say that when you report what " +
        "is about to happen.",
      next:
        `Tell the person a mail is waiting at ${asked.email}, and that the trip is still ` +
        "there until they open it and press the button. Do not report this as deleted.",
    },
    { status: 202 },
  );
}
