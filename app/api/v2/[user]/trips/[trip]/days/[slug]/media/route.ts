// POST/DELETE .../days/{slug}/media — B1656.
//
// The gap this closes: `POST /api/v2/{user}/media` (lib/api/v2/media.ts)
// only ever writes bytes and a sidecar — its own header comment used to say
// outright that a day reference is "the day route's business, not this
// one's" — and nothing else ever wrote a `src` into a v2 day's own `media`
// array. `attachGallery`/`detachGallery` (lib/api/entries.ts) are v1's pair
// for the same job, against markdown days; this is their v2-native sibling.
//
// Deliberately its OWN door rather than `PATCH .../days/{slug}` (D20,
// 06-contract-deltas.md): a `PATCH` re-validates the whole merged document
// against `dayWrite`, which asks all 14 `DAY_DECLINABLES` at once — so
// attaching a photograph to a day that has never answered its other
// declinables would refuse on fields nobody just asked about. Same shape as
// why `publish`/`unpublish` are their own calls rather than a `status` PATCH.
import { dayDoc } from "@/lib/api/v2/schemas";
import { tripRef } from "@/lib/trips";
import { dayMediaAttachRequest, dayMediaDetachRequest } from "@/lib/api/v2/schemas/dayMedia";
import { etagFor, fail, ifMatchStale, ok, readJson } from "@/lib/api/v2/route";
import { resolveBearer, ownsUser, outOfScopeRefusal } from "@/lib/api/v2/auth";
import { mayWriteTrip, refuseWrite } from "@/lib/api/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readTripFile, readDayFile } from "@/lib/api/v2/store";
import { attachDayMedia, detachDayMedia, dayEchoInput, withResolvedTest } from "@/lib/api/v2/days";
import type { TripFile } from "@/lib/api/v2/documents";
import type { Trip } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteCtx = RouteContext<"/api/v2/[user]/trips/[trip]/days/[slug]/media">;

function tripLike(user: string, tripId: string, trip: TripFile): Trip {
  return { username: user, id: tripId, ref: `${user}/${tripId}`, people: trip.people } as unknown as Trip;
}

/** Same trip-write gate `days/[slug]/route.ts`'s own `gateTrip` runs — not
 * imported from there since that function is that file's own local helper,
 * not exported; both are the same three calls (`resolveBearer`, `ownsUser`,
 * `readTripFile` + `mayWriteTrip`) rather than route-glue worth sharing. */
async function gateTrip(
  request: Request,
  user: string,
  tripId: string,
): Promise<{ ok: false; response: Response } | { ok: true; trip: TripFile }> {
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return { ok: false, response: bearer.response };
  if (!ownsUser(bearer.session, user)) return { ok: false, response: outOfScopeRefusal(bearer.session, user) };

  const stored = readTripFile(user, tripId);
  if (!stored) return { ok: false, response: fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404) };

  const gate = await mayWriteTrip(bearer.session, tripLike(user, tripId, stored));
  if (!gate.ok) return { ok: false, response: refuseWrite(gate) };

  return { ok: true, trip: stored };
}

/** The day, its echo and its ETag in one read — every route below needs all
 * three (the ETag for the If-Match check, the echo for a stale refusal's
 * `details`), and reading the file twice to get them would just be two
 * chances for a second writer to land in between. */
function readCurrent(user: string, tripId: string, slug: string, trip: TripFile) {
  const stored = readDayFile(user, tripId, slug);
  if (!stored) return null;
  const doc = dayDoc.parse(withResolvedTest(dayEchoInput(stored, tripRef(user, tripId)), trip, stored));
  return { doc, etag: etagFor(doc) };
}

export async function POST(request: Request, { params }: RouteCtx) {
  const { user, trip: tripId, slug } = await params;
  const gate = await gateTrip(request, user, tripId);
  if (!gate.ok) return gate.response;

  const current = readCurrent(user, tripId, slug, gate.trip);
  if (!current) return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);
  if (ifMatchStale(request, current.etag)) {
    return fail("stale_document", ERROR_CODES.stale_document, current.doc, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = dayMediaAttachRequest.safeParse(body.value);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      `${ERROR_CODES.invalid_request} Send {"items":[{"src": "...", "caption"?, "visibility"?}]}.`,
      parsed.error.issues.map((i) => ({ field: i.path.join(".") || "(items)", problem: i.message })),
      400,
    );
  }

  const result = attachDayMedia(user, tripId, slug, parsed.data.items);
  if (!result.ok) {
    if (result.error === "unknown_day") return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);
    return fail("not_this_trip", ERROR_CODES.not_this_trip, result.problems, 400);
  }

  const echo = dayDoc.parse(withResolvedTest(dayEchoInput(result.day, tripRef(user, tripId)), gate.trip, result.day));
  return ok(echo, { etag: etagFor(echo) });
}

export async function DELETE(request: Request, { params }: RouteCtx) {
  const { user, trip: tripId, slug } = await params;
  const gate = await gateTrip(request, user, tripId);
  if (!gate.ok) return gate.response;

  const current = readCurrent(user, tripId, slug, gate.trip);
  if (!current) return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);
  if (ifMatchStale(request, current.etag)) {
    return fail("stale_document", ERROR_CODES.stale_document, current.doc, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = dayMediaDetachRequest.safeParse(body.value);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      `${ERROR_CODES.invalid_request} Send {"srcs":["..."]} — exactly as GET .../days/${slug} carries them.`,
      parsed.error.issues.map((i) => ({ field: i.path.join(".") || "(srcs)", problem: i.message })),
      400,
    );
  }

  const result = detachDayMedia(user, tripId, slug, parsed.data.srcs);
  if (!result.ok) {
    if (result.error === "unknown_day") return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);
    return fail("unknown_media", ERROR_CODES.unknown_media, result.problems, 404);
  }

  const echo = dayDoc.parse(withResolvedTest(dayEchoInput(result.day, tripRef(user, tripId)), gate.trip, result.day));
  return ok(echo, { etag: etagFor(echo) });
}
