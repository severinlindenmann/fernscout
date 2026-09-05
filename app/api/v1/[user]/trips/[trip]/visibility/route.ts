import { authenticate, errorResponse, ownsUser } from "@/lib/api/auth";
import { patchTripVisibility, readTripVisibility } from "@/lib/api/tripVisibility";
import { SESSION_SCOPE } from "@/lib/auth";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

async function resolve(request: Request, user: string, trip: string) {
  const auth = await authenticate(request);
  if (!auth.ok) return { ok: false as const, response: errorResponse(auth) };

  if (!ownsUser(auth.session, user)) {
    return { ok: false as const, response: Response.json({ error: "out_of_scope" }, { status: 403 }) };
  }

  const ref = tripRef(user, trip);
  if (!getTrip(ref)) {
    return { ok: false as const, response: Response.json({ error: "unknown_trip" }, { status: 404 }) };
  }

  /**
   * The owner, and nobody else — not even somebody on the trip, and for a
   * stronger reason than `.../rates`: a trip-scoped token belongs to somebody
   * who is *on* the bus, and being on it is not the same as deciding who else
   * may read the journey. `createTrip` draws the identical line at creation —
   * only the owner could write `visibility:` there — and this is that same
   * door, opened after the fact.
   */
  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error: "out_of_scope",
          message:
            "This token is scoped to one trip, so it can write days into that trip, but it " +
            "cannot decide who else may read it. A trip's visibility is metadata about the " +
            "trip, the same shelf rates and people: sit on — only the journal's owner can " +
            "write it.",
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const, ref };
}

/**
 * A trip's `visibility:` and `listed:` — B396.
 *
 * `createTrip` could only ever write these once, at the moment a trip is
 * made, because nothing edited `trip.md` afterwards (B207). The contacts
 * page tells an owner with no `guest` trip to "set a trip's visibility to
 * guest" — on a hosted instance nobody has a shell, so that instruction went
 * nowhere until this door opened. Owner only, like `createTrip` itself.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/visibility">,
) {
  const { user, trip } = await params;
  const resolved = await resolve(request, user, trip);
  if (!resolved.ok) return resolved.response;
  return Response.json({ trip: resolved.ref, ...readTripVisibility(resolved.ref) });
}

/**
 * Change visibility, listed, or both in one call — send only what changes.
 * `{"visibility": "guest"}` is the whole of what the contacts page's banner
 * now asks for. `{"listed": false}` on its own is the old `unlisted`.
 *
 * **Widening is said out loud.** Moving from `private` or `guest` towards
 * `public`, or from `private` to `guest`, exposes days already published
 * under the old, narrower visibility to a wider audience the moment this
 * call returns — nothing about the days themselves changes, only who may now
 * read them. Narrowing needs no such warning: it can only take readers away,
 * never add one.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/visibility">,
) {
  const { user, trip } = await params;
  const resolved = await resolve(request, user, trip);
  if (!resolved.ok) return resolved.response;
  const { ref } = resolved;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = patchTripVisibility(ref, body);
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
    visibility: result.visibility,
    listed: result.listed,
    note: result.widened
      ? `This widens who may read "${trip}": everything already published on it — every day, ` +
        "its costs where they're public — is now open to a broader audience than it was a " +
        "moment ago. Say that plainly before telling anyone this is done."
      : "Every day already published on this trip keeps reading the same way to whoever could " +
        "already read it; this only changes who else may now open it.",
  });
}
