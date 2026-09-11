import { patchTripParty, readTripParty, resolveTripOwner } from "@/lib/api/tripParty";

export const dynamic = "force-dynamic";

const REFUSAL =
  "This token is scoped to one trip, so it can write days into that trip, but it cannot say " +
  "who else may. Everyone on people: may write to the whole trip, so changing the list is " +
  "handing out the authority this token holds — only the journal's owner can do that.";

/**
 * A trip's `people:` block — B524, the half that carries write access.
 *
 * "My partner was on this trip too", arriving after the trip exists, is the
 * ordinary case rather than the exception, and until this door there was no
 * answer to it but deleting the trip and rewriting every day in it.
 *
 * What this does **not** show is who reached the trip through a buddy link:
 * `peopleOf()` merges those rows in at read time and they are not in the file.
 * This is the file, which is also the byline — the owner's editorial statement
 * about whose trip it was.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/people">,
) {
  const { user, trip } = await params;
  const resolved = await resolveTripOwner(request, user, trip, REFUSAL);
  if (!resolved.ok) return resolved.response;
  return Response.json({
    trip: resolved.ref,
    people: readTripParty(resolved.ref)?.people ?? [],
    note:
      "This is trip.md's own list — the byline, and who may write to the trip. Anyone the " +
      "owner approved through a buddy link may write too and is not in here.",
  });
}

/**
 * Replace the block — the whole list, not the person who changed.
 *
 * The response says what that did in access terms rather than answering `ok`,
 * because this is the one trip field whose edit hands out or takes away
 * authority: everyone named may write to the whole trip and may ask for a
 * token scoped to it, using the address given.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/people">,
) {
  const { user, trip } = await params;
  const resolved = await resolveTripOwner(request, user, trip, REFUSAL);
  if (!resolved.ok) return resolved.response;

  const before = readTripParty(resolved.ref)?.people ?? [];

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body) || !("people" in body)) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          'Send {"people": [{"name": "Ana Meyer", "email": "ana@example.test"}]} — the whole ' +
          "list, since this replaces what is there. Read it back first if you mean to add " +
          "somebody. `[]` clears it, leaving the owner alone on the trip.",
      },
      { status: 400 },
    );
  }

  const result = patchTripParty(resolved.ref, "people", body.people);
  if (!result.ok) {
    const status = result.bug ? 500 : result.error === "unknown_trip" ? 404 : 400;
    return Response.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status },
    );
  }

  const was = new Set(before.map((p) => p.email));
  const now = new Set(result.people.map((p) => p.email));
  const added = result.people.filter((p) => !was.has(p.email)).map((p) => p.email);
  const removed = before.filter((p) => !now.has(p.email)).map((p) => p.email);

  return Response.json({
    ok: true,
    trip: resolved.ref,
    people: result.people,
    added,
    removed,
    note:
      (added.length
        ? `${added.join(", ")} may now write to every day of this trip and may ask for a token ` +
          `scoped to it, using that address. `
        : "") +
      (removed.length
        ? `${removed.join(", ")} is no longer on the trip and no longer in the byline. Any ` +
          `trip-scoped token already issued to that address can no longer write to it — this ` +
          `is re-checked on every request, so there is nothing left to revoke. `
        : "") +
      "The byline on the trip changes with this list; a buddy the owner approved separately is " +
      "unaffected.",
  });
}
