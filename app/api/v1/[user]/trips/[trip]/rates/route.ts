import { authenticate, errorResponse, ownsUser } from "@/lib/api/auth";
import { patchTripRates, readTripRates } from "@/lib/api/tripRates";
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
   * The owner, and nobody else — not even somebody on the trip.
   *
   * Unlike `.../costs`, which `mayWriteTrip` opens to everyone in `people:`
   * because a budget is trip content and the people on a trip are the people
   * who spent the money, a rate table is closer to the trip's own metadata —
   * the same shelf `visibility` and `people:` sit on, which `PATCH
   * .../trips/<trip>` already refuses to a trip-scoped token. `createTrip`
   * draws the same line: only the owner could write `rates:` at creation, so
   * only the owner can amend it afterwards.
   */
  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error: "out_of_scope",
          message:
            "This token is scoped to one trip, so it can write days into that trip, but it " +
            "cannot change its rate table. A trip's exchange rates are metadata about the " +
            "trip, the same shelf visibility and people: sit on — only the journal's owner " +
            "can write them.",
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const, ref };
}

/**
 * A trip's `rates:` table — B352.
 *
 * `createTrip` could only ever write this once, at the moment a trip is
 * made, because nothing edited `trip.md` afterwards (B207). The costs page
 * tells an owner with an unrated currency to "add the missing rates to the
 * trip's trip.md" — on a hosted instance nobody has a shell, so that
 * instruction went nowhere until this door opened. Owner only, like
 * `createTrip` itself: `rates` is metadata about the trip, not content a
 * traveller logs.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/rates">,
) {
  const { user, trip } = await params;
  const resolved = await resolve(request, user, trip);
  if (!resolved.ok) return resolved.response;
  return Response.json({ trip: resolved.ref, rates: readTripRates(resolved.ref) });
}

/**
 * Add or change one or more rates, without disturbing any already on the
 * trip — send `{"THB": 0.0245}` to fill in the one currency a trip is
 * missing, not the whole table. `lib/tripWrite.ts`'s own `ratesBlock`
 * validates the merged result, so a rate rejected here would have been
 * rejected at creation too, and one written here reads back exactly the
 * same way.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/rates">,
) {
  const { user, trip } = await params;
  const resolved = await resolve(request, user, trip);
  if (!resolved.ok) return resolved.response;
  const { ref } = resolved;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!("rates" in body)) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          'Send {"rates": {"EUR": 0.94}} — units of the base currency for one unit of the ' +
          "keyed currency.",
      },
      { status: 400 },
    );
  }

  const result = patchTripRates(ref, body.rates);
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
    rates: result.rates,
    note:
      "trip.md now carries these rates. Costs already recorded in the currencies you just " +
      "added will convert the next time the costs page — or any total drawn from it — is read.",
  });
}
