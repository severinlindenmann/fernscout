import { authenticate, errorResponse, mayActAsOwner, mayWriteTrip, outOfScope, ownsUser } from "@/lib/api/auth";
import { DELETION_TTL_MINUTES, humanBytes, requestDeletion } from "@/lib/deletions";
import { tripTombstone } from "@/lib/tombstones";
import { patchTripDetails } from "@/lib/api/tripDetails";
import { getTrip, tripRef } from "@/lib/trips";
import { tripSummary } from "@/lib/api/entries";

export const dynamic = "force-dynamic";

/**
 * One trip, whole.
 *
 * Added in B540, and the reason is a rule this codebase already states one
 * level down: *a field the API takes is a field it has to show*
 * (`…/days/[slug]/route.ts`). At trip level it was not true. `POST .../trips`
 * invites a caller to set eleven optional fields, and five of them — `accent`,
 * `costsVisibility`, `intro`, `translations`, `test` — could be written and
 * then read back nowhere: `GET .../trips` is a summary, and the dedicated
 * doors cover only `visibility`, `rates`, `people`, `travellers` and `tracks`.
 * An agent told to check its own work could not, and "it was accepted" is not
 * the same claim as "it is there" — which is the whole lesson of the two
 * fields this same ticket found being accepted and dropped.
 *
 * Gated as a write is, not as a read: it carries `people`, which is addresses.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip } = await params;
  if (!ownsUser(auth.session, user)) {
    return outOfScope(auth.session, user);
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  // A trip that does not exist and one this token may not touch answer alike,
  // so this cannot be used to ask which trips a journal has.
  const gate = found ? await mayWriteTrip(auth.session, found) : null;
  if (!found || !gate?.ok) return Response.json({ error: "unknown_trip" }, { status: 404 });

  return Response.json({
    ...tripSummary(user, trip),
    // The five that had no read path anywhere, plus the blocks that do have
    // their own doors — a caller reading one trip wants the trip, not five
    // more calls.
    ...(found.accent ? { accent: found.accent } : {}),
    ...(found.cover ? { cover: found.cover } : {}),
    costsVisibility: found.costsVisibility,
    intro: found.intro,
    ...(found.translations ? { translations: found.translations } : {}),
    people: found.people,
    travellers: found.travellers,
    rates: found.rates,
  });
}

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
    return outOfScope(auth.session, user);
  }

  /**
   * The owner, and nobody else — not even somebody on the trip.
   *
   * `mayWriteTrip` would pass a `write:trip:<id>` token here, and that is
   * exactly the check this must not use. Everyone in a trip's `people:` may
   * write to the whole trip; being able to add a day to somebody's honeymoon
   * is not a reason to be able to delete the honeymoon.
   */
  if (!mayActAsOwner(auth.session, user)) {
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

/**
 * A trip's title, subtitle, dates and cover — B622, cover since B245.
 *
 * Title/tagline/start/end were the last four fields of a trip nothing could
 * write, and until B621 this handler said so: it was a `405` that named every
 * door that did exist and ended *"A trip's title, dates and cover are still
 * trip.md alone and no call writes them."* B621 then built the writer and put
 * a browser-only door in front of it, for the owner standing on their own
 * page — which left an agent being told to ask a person to open a form, in a
 * codebase whose first rule is that the agent is the editor.
 *
 * `cover` was still trip.md-alone after B621: at trip-creation time there is
 * no `media/` folder for it to name (`lib/tripWrite.ts`), so it could only be
 * set once photographs exist — and nothing wrote it even then. B245 closes
 * that: `patchTripDetails` now checks a `cover` against the trip's own
 * gallery (`getAllMedia`) and refuses one that names a file the trip does not
 * have, rather than writing a value that would render as a broken image.
 *
 * `patchTripDetails` (lib/api/tripDetails.ts) is the same function that door
 * calls, so the rules cannot differ between them: a title that cannot be
 * cleared, a subtitle whose emptying removes the key, dates that must parse
 * and must not run backwards, a cover that must name a photo already in the
 * trip, and a splice that leaves the prose and every other key byte for byte.
 *
 * **Owner only**, like `.../visibility` and unlike `.../days`. A trip-scoped
 * token belongs to somebody who was on the bus; adding a day to a journey is
 * not the same authority as saying what the journey is called. The scope
 * check is the identical one three routes on this shelf already make.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip } = await params;
  if (!ownsUser(auth.session, user)) {
    return outOfScope(auth.session, user);
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  // Same shape as `GET` above: a trip that does not exist and one this token
  // may not touch answer alike, so this cannot be used to ask which trips a
  // journal has.
  const gate = found ? await mayWriteTrip(auth.session, found) : null;
  if (!found || !gate?.ok) return Response.json({ error: "unknown_trip" }, { status: 404 });

  if (!mayActAsOwner(auth.session, user)) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip, so it can write days into that trip, but it " +
          "cannot change what the trip is called or when it ran. A trip's title and dates are " +
          "metadata about the journey, the same shelf visibility, rates and people: sit on — " +
          "only the journal's owner can write them.",
      },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const FIELDS = ["title", "tagline", "start", "end", "cover"] as const;
  if (!FIELDS.some((field) => body[field] !== undefined)) {
    return Response.json(
      {
        error: "nothing_to_change",
        message:
          `Name at least one of ${FIELDS.join(", ")}. Everything else about a trip has a door ` +
          `of its own: visibility, rates, people, travellers and tracks are each one level down ` +
          `from here.`,
      },
      { status: 400 },
    );
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
    trip: ref,
    title: result.title,
    tagline: result.tagline,
    start: result.start,
    end: result.end,
    ...(result.cover ? { cover: result.cover } : {}),
  });
}
