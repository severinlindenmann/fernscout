// POST .../days/{slug}/move — B1903, v2's own door onto
// `moveDayTransactional` (lib/studio/reshapeDay.ts, B1832).
//
// Why this had to be a real door rather than a composed one: media is
// stored under `trips/<tripId>/media/<bareSlug>/`, keyed by trip id, so a
// cross-trip move relocates a stored photograph's identity between folders.
// Re-uploading the bytes under the new trip would make a NEW print master,
// not move the original one — AGENTS.md forbids treating those as
// equivalent ("a photograph upload keeps the original as its print
// master"). `moveDayTransactional` is the only writer in the repository
// that actually renames the folder in place; this route reuses it verbatim.
//
// A same-trip, date-only move already composed today (GET, PUT at the new
// stem, DELETE the old one) — this route does not replace that path, it
// documents and covers it as the same call, along with the cross-trip case
// nothing could reach before.
//
// **Path validation, B1892.** The studio's own cookie door onto this same
// function had a path-traversal defect: it gated correctly on the owner's
// cookie and then passed `body.fromTripId`/`body.tripId`/`body.date`
// straight into path building, unchecked. It is fixed now at the lowest
// layer (`lib/api/v2/store.ts`'s `safeSegment`, which every read/write here
// still goes through) and again in `reshapeDay.ts` itself (`knownTrip`,
// `DATE_RE`) — this route inherits both by calling the exact same function,
// and adds nothing of its own that touches a path directly.
import { dayMoveRequest, dayMoveResult } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { ok, readDryRun } from "@/lib/api/v2/route";
import { gateReshape, bareSlugOf, reshapeFail } from "@/lib/api/v2/reshapeGate";
import { v2Slug } from "@/lib/api/v2/days";
import { moveDayTransactional } from "@/lib/studio/reshapeDay";
import { readDayFile } from "@/lib/api/v2/store";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/trips/[trip]/days/[slug]/move">) {
  const { user, trip: fromTripId, slug } = await params;
  const gate = await gateReshape(request, user, slug);
  if (!gate.ok) return gate.response;

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = jsonBody.value;
  const result = dayMoveRequest.safeParse(parsed);
  if (!result.success) {
    return reshapeFail("invalid_request", "This is not a usable move.", { problems: problemsFrom(result.error) });
  }
  const { toTripId, date } = result.data;
  const bareSlug = bareSlugOf(slug);

  const dryRun = readDryRun(request);
  if (dryRun === null) return reshapeFail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    // A real read, no write — `addressChanged` is true only for a
    // cross-trip move of an ALREADY-PUBLISHED day (the permalink carries
    // the trip id, never the date — moveDayTransactional's own doc
    // comment), so the preview has to know the stored status, not just
    // guess from the trip ids.
    const stored = readDayFile(user, fromTripId, slug);
    const published = stored?.status === "published";
    return ok(
      dayMoveResult.parse({
        ok: true,
        tripId: toTripId,
        slug: v2Slug(date, bareSlug),
        addressChanged: toTripId !== fromTripId && published,
        dryRun: true,
      }),
    );
  }

  const moved = moveDayTransactional(user, fromTripId, bareSlug, { tripId: toTripId, date });
  if (!moved.ok) {
    // Spelled out (not `reshapeFail(moved.error, ERROR_CODES[moved.error])`)
    // so every code this route can answer with is a literal string here —
    // `test/openapi-v2-contract.test.ts` walks route files for exactly that.
    switch (moved.error) {
      case "unknown_trip":
        return reshapeFail("unknown_trip", ERROR_CODES.unknown_trip);
      case "unknown_day":
        return reshapeFail("unknown_day", ERROR_CODES.unknown_day);
      case "invalid_date":
        return reshapeFail("invalid_date", ERROR_CODES.invalid_date);
      case "already_exists":
        return reshapeFail("already_exists", ERROR_CODES.already_exists);
      default: {
        const exhaustive: never = moved.error;
        throw new Error(`unhandled move error: ${String(exhaustive)}`);
      }
    }
  }

  return ok(
    dayMoveResult.parse({
      ok: true,
      tripId: toTripId,
      slug: v2Slug(date, bareSlug),
      addressChanged: moved.addressChanged,
    }),
  );
}
