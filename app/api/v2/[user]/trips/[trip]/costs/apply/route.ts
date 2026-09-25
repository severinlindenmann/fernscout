// POST /api/v2/{user}/trips/{trip}/costs/apply — B1624, phase 2 step 4.
// docs/plans/2026-09-12-api-v2/content.md §3. Renamed from v1's
// `.../costs/import`: "import" now means the media door's own verb, and this
// call does something different — it applies agreed rows, it does not import
// anything. Writable by anybody who may write the trip, trip-scoped tokens
// included: the statement read is journal-wide (owner only), but agreeing
// rows onto days of a trip is ordinary trip-write authority.
import { costsApplyRequest } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { fail, ok, readJson } from "@/lib/api/v2/route";
import { outOfScopeRefusal, ownsUser, resolveBearer } from "@/lib/api/v2/auth";
import { mayWriteTrip } from "@/lib/api/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { applyCosts } from "@/lib/statements/apply";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/trips/[trip]/costs/apply">,
) {
  const { user, trip: tripId } = await params;
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const trip = getTrip(tripRef(user, tripId));
  if (!trip) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);

  const gate = await mayWriteTrip(bearer.session, trip);
  if (!gate.ok) {
    return fail(
      "forbidden",
      "This token's access to this trip has been revoked. Ask the owner for a new one.",
      undefined,
      403,
    );
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  const result = costsApplyRequest.safeParse(parsed.value);
  if (!result.success) {
    return fail("invalid_costs", ERROR_CODES.invalid_costs, problemsFrom(result.error), 400);
  }

  const applied = applyCosts(trip.ref, result.data.rows);
  // Past the cost-line bound on a day or on the trip (B2243): nothing written.
  if ("problems" in applied) {
    return fail(
      "invalid_costs",
      `${ERROR_CODES.invalid_costs} Nothing was written.`,
      applied.problems.map((p) => ({ field: p.field, problem: `${p.got} — ${p.expected}` })),
      400,
    );
  }
  const filedRows = applied.filedToTrip.reduce((sum, f) => sum + f.rows, 0);

  return ok({
    trip: trip.id,
    ...applied,
    message:
      `${applied.total} cost${applied.total === 1 ? "" : "s"} written across ` +
      `${applied.written.length} day${applied.written.length === 1 ? "" : "s"}` +
      (filedRows > 0
        ? `, and ${filedRows} row${filedRows === 1 ? "" : "s"} with no matching day filed to the trip itself.`
        : ".") +
      (applied.written.some((w) => w.kept > 0) ? " Costs already on those days were kept." : ""),
    ...(applied.filedToTrip.length > 0
      ? {
          // B1844 — the owner's own ruling: a cost you paid is a fact
          // whether or not a day exists for it, so a date with no day
          // written no longer means nothing was recorded. It means this
          // instead — which dates had no day, filed to the trip's own
          // `costs.items` rather than to a day.
          next:
            `${applied.filedToTrip.length} date${applied.filedToTrip.length === 1 ? " has" : "s have"} ` +
            "no day written yet, so those rows were filed to the trip itself rather than to a " +
            "day. Write those days and move the rows across if they should live there instead.",
        }
      : {}),
  });
}
