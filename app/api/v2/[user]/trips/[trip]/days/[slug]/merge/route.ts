// POST .../days/{slug}/merge — B1903, v2's own door onto
// `mergeDaysTransactional` (lib/studio/reshapeDay.ts, B1832).
//
// Joins two updates into one, refused across trips (M6✗) — `withSlug` names
// the other day, on the same trip as the URL's `{trip}`. Relocates the
// loser's photographs into the survivor's media folder on disk, same
// reasoning as the move and split routes: there is no v2 primitive that
// moves a stored photograph's identity any other way without minting a new
// print master. See the move route's own comment for the shared B1892
// path-traversal reasoning.
import { dayMergeRequest, dayMergeResult } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { ok, readDryRun } from "@/lib/api/v2/route";
import { gateReshape, bareSlugOf, reshapeFail } from "@/lib/api/v2/reshapeGate";
import { mergeDaysTransactional } from "@/lib/studio/reshapeDay";
import { readDayFile } from "@/lib/api/v2/store";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/trips/[trip]/days/[slug]/merge">) {
  const { user, trip: tripId, slug } = await params;
  const gate = await gateReshape(request, user, slug);
  if (!gate.ok) return gate.response;

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = jsonBody.value;
  const result = dayMergeRequest.safeParse(parsed);
  if (!result.success) {
    return reshapeFail("invalid_request", "This is not a usable merge.", { problems: problemsFrom(result.error) });
  }
  const { withSlug } = result.data;
  // Absent = the URL's own trip — see the schema's own doc comment on why a
  // caller naming a DIFFERENT trip here is refused rather than composed.
  const withTripId = result.data.withTripId ?? tripId;
  const slugA = bareSlugOf(slug);
  const slugB = bareSlugOf(withSlug);

  const dryRun = readDryRun(request);
  if (dryRun === null) return reshapeFail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    if (withTripId !== tripId) return reshapeFail("cross_trip", ERROR_CODES.cross_trip);
    // A real read, no write: the survivor is whichever of the two sorts
    // earlier by date then time — same comparison mergeDaysTransactional
    // itself makes — so the preview names the actual slug a real call would
    // answer with, not a guess.
    const dayA = readDayFile(user, tripId, slug);
    const dayB = readDayFile(user, withTripId, withSlug);
    if (!dayA || !dayB) return reshapeFail("unknown_day", ERROR_CODES.unknown_day);
    const aFirst = `${dayA.date}${dayA.time ?? ""}` <= `${dayB.date}${dayB.time ?? ""}`;
    return ok(dayMergeResult.parse({ ok: true, slug: aFirst ? slug : withSlug, dryRun: true }));
  }

  const merged = mergeDaysTransactional(user, tripId, slugA, withTripId, slugB);
  if (!merged.ok) {
    // Spelled out so every code this route answers with is a literal string
    // here — `test/openapi-v2-contract.test.ts` walks route files for that.
    switch (merged.error) {
      case "unknown_trip":
        return reshapeFail("unknown_trip", ERROR_CODES.unknown_trip);
      case "unknown_day":
        return reshapeFail("unknown_day", ERROR_CODES.unknown_day);
      case "cross_trip":
        return reshapeFail("cross_trip", ERROR_CODES.cross_trip);
      default: {
        const exhaustive: never = merged.error;
        throw new Error(`unhandled merge error: ${String(exhaustive)}`);
      }
    }
  }

  const survivorStem = merged.slug === slugA ? slug : withSlug;
  return ok(dayMergeResult.parse({ ok: true, slug: survivorStem }));
}
