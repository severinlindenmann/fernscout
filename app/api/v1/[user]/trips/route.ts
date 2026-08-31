import { authenticate, errorResponse, ownsUser, writableTrips } from "@/lib/api/auth";
import { tripSummary } from "@/lib/api/entries";
import { getTrips } from "@/lib/trips";
import { createTrip } from "@/lib/tripWrite";
import { SESSION_SCOPE } from "@/lib/auth";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Every trip in this journal, including ones the public cannot see. */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/trips">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) {
    // A token is scoped to one journal. Saying "forbidden" rather than
    // "not found" is safe here: the caller already proved who they are.
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  // Only the trips this token can actually reach. A trip-scoped token listing
  // the whole journal would tell somebody who came on one trip what else its
  // owner has been doing.
  return Response.json({
    user,
    trips: writableTrips(auth.session, getTrips(user))
      .map((t) => tripSummary(user, t.id))
      .filter(Boolean),
  });
}

/**
 * Create a trip.
 *
 * `create_day` has always needed a trip to write into and there was no way to
 * make one, so an agent handed a fresh journal could do nothing at all with
 * it. This closes that.
 *
 * **Only the journal's owner may.** A trip-scoped token — held by somebody who
 * came on one trip — can write days into that trip and must not be able to
 * conjure new ones beside it; its scope names a trip that would not be the one
 * it creates. That is the difference between a guest writing in the book and a
 * guest starting a new book.
 *
 * Unlike a day, a trip is **not** a draft. There is no such thing: the draft
 * rule protects readers from invented memories presented as fact, and an empty
 * trip asserts nothing. What protects them here is the visibility default,
 * which is `private` unless the caller says otherwise.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/v1/[user]/trips">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }
  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip, so it can write days into that trip but cannot " +
          "create new ones. Only the journal's owner can create a trip.",
      },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof body[key] === "string" ? (body[key] as string) : undefined;

  const id = str("id") ?? "";
  const title = str("title") ?? "";
  const start = str("start") ?? "";
  const end = str("end") ?? "";
  if (!id || !title || !start || !end) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          'A trip needs {"id", "title", "start", "end"} — the dates as 2027-04-01. ' +
          "They are not optional: the site skips a trip that has no dates, so one written " +
          "without them would exist on disk and nowhere a reader could find it.",
      },
      { status: 400 },
    );
  }

  const created = createTrip(user, {
    id,
    title,
    tagline: str("tagline"),
    start,
    end,
    status: str("status") as never,
    accent: str("accent") as never,
    visibility: str("visibility") as never,
    listed: typeof body.listed === "boolean" ? body.listed : undefined,
    intro: str("intro"),
  });

  if (!created.ok) {
    const status = created.error === "trip_exists" ? 409 : created.error === "no_such_journal" ? 404 : 400;
    return Response.json({ error: created.error, message: created.message }, { status });
  }

  const summary = tripSummary(user, created.id);
  return Response.json(
    {
      ok: true,
      trip: summary,
      url: `${serverSite().url}/${user}/trips/${created.id}`,
      note:
        summary && summary.visibility === "private"
          ? "Created private: nobody but you can read it. Set visibility to \"public\" when it is ready."
          : undefined,
      next: `POST /api/v1/${user}/trips/${created.id}/days to write the first day.`,
    },
    { status: 201 },
  );
}
