// GET/PUT /api/v2/{user}/trips/{trip}/track-edits — B2539, D8 C.
//
// The owner can hide a spot (a circle), hide a stretch (a time range) or
// name a stretch (a time range with a label, "Boat trip · dolphins") on one
// trip's recorded route. Domain logic lives in `lib/gps/api.ts`
// (`listTrackEdits`, `writeTrackEdits`) — this route parses, authenticates
// and echoes, the same division `gps/zones` keeps, right down to the
// optimistic-concurrency `If-Match` dance: two tabs editing the same trip's
// hidden spots must not silently overwrite each other, the same reasoning
// `gps/zones`'s own doc comment gives.
//
// `trackEditsGetDoc`/`trackEditsPutResponse` are exported for
// `app/api/web/[user]/trips/[trip]/track-edits/route.ts` to call in process
// after its own cookie-only `isOwner` check — the same split `gps/zones`
// uses for its web twin.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { etagFor, fail, ifMatchStale, ok, readJson } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { trackEditsWrite } from "@/lib/api/v2/schemas/trackEdits";
import { EDIT_LIMITS, listTrackEdits, writeTrackEdits, type TrackEdits } from "@/lib/gps/api";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const limits = {
  maxSpots: EDIT_LIMITS.maxSpots,
  maxStretches: EDIT_LIMITS.maxStretches,
  maxNamed: EDIT_LIMITS.maxNamed,
  radiusM: { min: EDIT_LIMITS.minRadiusM, max: EDIT_LIMITS.maxRadiusM },
  labelMax: EDIT_LIMITS.labelMax,
};

// Never cached, same reasoning as `gps/zones`: a stale copy of what the
// owner hid sitting in a shared cache is the exact leak this door exists to
// prevent, and a PUT's echo carries the edits right back out too.
const NO_STORE = { "Cache-Control": "no-store" };

function tripOr404(user: string, tripId: string) {
  if (!getUser(user)) return { ok: false as const, response: fail("unknown_user", ERROR_CODES.unknown_user, undefined, 404) };
  const trip = getTrip(tripRef(user, tripId));
  if (!trip) return { ok: false as const, response: fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404) };
  return { ok: true as const, trip };
}

export function trackEditsGetDoc(user: string, tripId: string): Response {
  const found = tripOr404(user, tripId);
  if (!found.ok) return found.response;
  const doc = { ...listTrackEdits(user, tripId), limits };
  return ok(doc, { etag: etagFor(doc), headers: NO_STORE });
}

export async function trackEditsPutResponse(user: string, tripId: string, request: Request): Promise<Response> {
  const found = tripOr404(user, tripId);
  if (!found.ok) return found.response;

  const currentDoc = { ...listTrackEdits(user, tripId), limits };
  const currentEtag = etagFor(currentDoc);
  if (!request.headers.get("if-match") || ifMatchStale(request, currentEtag)) {
    return fail("stale_document", ERROR_CODES.stale_document, currentDoc, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = trackEditsWrite.safeParse(body.value);
  if (!parsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsed.error), 400);
  }

  const result: TrackEdits = writeTrackEdits(user, tripId, parsed.data);
  const doc = { ...result, limits };
  return ok(doc, { etag: etagFor(doc), headers: NO_STORE });
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/trips/[trip]/track-edits">) {
  const { user, trip } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return trackEditsGetDoc(user, trip);
}

export async function PUT(request: Request, { params }: RouteContext<"/api/v2/[user]/trips/[trip]/track-edits">) {
  const { user, trip } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return trackEditsPutResponse(user, trip, request);
}
