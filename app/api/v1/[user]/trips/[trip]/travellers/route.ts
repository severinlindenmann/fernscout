import { patchTripParty, readTripParty, resolveTripOwner } from "@/lib/api/tripParty";

export const dynamic = "force-dynamic";

const REFUSAL =
  "This token is scoped to one trip, so it can write days into that trip, but it cannot " +
  "change the trip's own fields. How the party is drawn is metadata about the trip, the " +
  "same shelf visibility and rates sit on — only the journal's owner can write it.";

/**
 * A trip's `travellers:` block — B524, the cheap half.
 *
 * `createTrip` could write this once and nothing could write it again, so a
 * trip created before anybody was asked how they would like to be drawn could
 * never carry its travellers — and on a hosted instance the guide's advice to
 * "write the block into trip.md" has nowhere to go. This is that door.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/travellers">,
) {
  const { user, trip } = await params;
  const resolved = await resolveTripOwner(request, user, trip, REFUSAL);
  if (!resolved.ok) return resolved.response;
  return Response.json({
    trip: resolved.ref,
    travellers: readTripParty(resolved.ref)?.travellers ?? [],
  });
}

/**
 * Replace the block — the whole party, not the figure that changed. Send `[]`
 * to go back to the one neutral figure a trip with no block draws.
 *
 * `lib/tripWrite.ts`'s own `travellersBlock` validates it, so a hair colour
 * refused here would have been refused at creation, and one written here reads
 * back exactly the same way. **Ask before writing**: an attribute nobody
 * answered gets the default, said out loud, rather than a plausible guess.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/travellers">,
) {
  const { user, trip } = await params;
  const resolved = await resolveTripOwner(request, user, trip, REFUSAL);
  if (!resolved.ok) return resolved.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body) || !("travellers" in body)) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          'Send {"travellers": [{"skin": "medium", "hair": "black"}]} — the whole party. ' +
          "GET /api/v2/<user>/figures/presets lists every word this takes, and " +
          "/figures/preview draws one so a person can see themselves before it is written.",
      },
      { status: 400 },
    );
  }

  const result = patchTripParty(resolved.ref, "travellers", body.travellers);
  if (!result.ok) {
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  return Response.json({
    ok: true,
    trip: resolved.ref,
    travellers: result.travellers,
    note:
      "This is how the trip's hero draws its party from now on. Nothing about who may read " +
      "or write the trip changed — that is people:, one door along.",
  });
}
