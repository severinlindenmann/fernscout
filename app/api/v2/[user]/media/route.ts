// GET/POST/DELETE /api/v2/{user}/media — B1613, phase 2 step 3, parcel C.
//
// One door for every kind of bytes a journal receives: what v1 split across
// /trips/{trip}/media, /inbox and (for a bank statement) /import. `intent`
// (lib/api/v2/schemas/media.ts) says what the bytes are and where they go;
// `storeMediaV2`/`listTripMediaV2`/`deleteMediaV2` (lib/api/v2/media.ts) are
// the domain functions that actually place, list and remove them. This file
// is only the request glue: parse, authenticate, gate, respond.
import { mediaIntent, type MediaIntent } from "@/lib/api/v2/schemas";
import { fail, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { mayActAsOwner, outOfScopeRefusal, ownerOnlyRefusal, ownsUser, resolveBearer } from "@/lib/api/v2/auth";
import { mayWriteTrip, type TripWriteGate } from "@/lib/api/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { getTrip, tripRef } from "@/lib/trips";
import { mediaKey } from "@/lib/photos";
import { fetchMedia } from "@/lib/api/fetchMedia";
import { loadUserConfig } from "@/lib/config";
import { REQUEST_MAX_BYTES } from "@/lib/validate/media";
import {
  deleteMediaV2,
  forgetInboxUpload,
  listTripMediaV2,
  resolveInboxUpload,
  storeMediaV2,
  type MediaUpload,
  type MediaWriteResult,
} from "@/lib/api/v2/media";
import type { Session } from "@/lib/auth";

export const dynamic = "force-dynamic";

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The v2 envelope for a gate refusal `lib/api/auth.ts`'s `mayWriteTrip`
 * answers with — v1's own `refuseWrite` builds a differently-shaped
 * `Response` and is deliberately not reused here (test/api-v2-imports.test.ts
 * only allowlists the domain half of that file). */
function refuseTripGate(gate: Extract<TripWriteGate, { ok: false }>) {
  if (gate.error === "unknown_trip") return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);
  return fail(
    "forbidden",
    "This token's access to this trip has been revoked. Ask the owner for a new one.",
    undefined,
    403,
  );
}

/**
 * Who may make this call, given what `intent` asked for.
 *
 * A trip named: the ordinary trip-write gate, same as every other write on a
 * trip — a trip-scoped token may use it. No trip (a decline): the file lands
 * in the journal-wide inbox, which is the owner's whole journal rather than
 * one trip, so a trip-scoped token is refused the same way `PATCH
 * /api/v2/{user}` already refuses one.
 */
async function gateIntent(session: Session, user: string, intent: MediaIntent) {
  if (!intent.trip) {
    if (!mayActAsOwner(session, user)) return ownerOnlyRefusal();
    return null;
  }
  const ref = tripRef(user, intent.trip);
  const trip = getTrip(ref);
  if (!trip) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);
  const gate = await mayWriteTrip(session, trip);
  if (!gate.ok) return refuseTripGate(gate);
  return null;
}

function refuseWriteResult(result: Extract<MediaWriteResult, { ok: false }>) {
  if (result.error === "unknown_trip") return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);
  if (result.error === "storage_full") return fail("storage_full", result.problem, undefined, 400);
  return fail("invalid_media", ERROR_CODES.invalid_media, result.problems, 400);
}

function previewOf(intent: MediaIntent, bytes: number) {
  return {
    src: "(preview — dryRun writes nothing)",
    kind: intent.kind,
    ...(intent.trip ? { trip: intent.trip } : {}),
    ...(intent.day ? { day: intent.day } : {}),
    ...(intent.caption ? { caption: intent.caption } : {}),
    bytes,
  };
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/media">) {
  const { user } = await params;
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const url = new URL(request.url);
  const tripId = url.searchParams.get("trip");
  if (!tripId) {
    return fail(
      "invalid_request",
      `${ERROR_CODES.invalid_request} Send ?trip=<id> — this list is one trip's own stored media.`,
      undefined,
      400,
    );
  }
  const trip = getTrip(tripRef(user, tripId));
  if (!trip) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);
  const gate = await mayWriteTrip(bearer.session, trip);
  if (!gate.ok) return refuseTripGate(gate);

  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), 200) : 50;
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const { items, nextCursor } = listTripMediaV2(user, tripId, { limit, cursor });
  return ok({ items, ...(nextCursor ? { next_cursor: nextCursor } : {}) });
}

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/media">) {
  const { user } = await params;
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const parsedBody = await readJson(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.value;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return fail("invalid_request", `${ERROR_CODES.invalid_request} The body must be a JSON object.`, undefined, 400);
    }
    const { intent: rawIntent, url: rawUrl, inbox: rawInbox } = body as Record<string, unknown>;

    const intentParsed = mediaIntent.safeParse(rawIntent);
    if (!intentParsed.success) {
      return fail(
        "invalid_request",
        `${ERROR_CODES.invalid_request} \`intent\` is not usable.`,
        intentParsed.error.issues.map((i) => ({ field: i.path.join(".") || "(intent)", problem: i.message })),
        400,
      );
    }
    const intent = intentParsed.data;

    const gated = await gateIntent(bearer.session, user, intent);
    if (gated) return gated;

    const fetchUrl = typeof rawUrl === "string" ? rawUrl : undefined;
    const inboxId = typeof rawInbox === "string" ? rawInbox : undefined;
    if (!fetchUrl && !inboxId) {
      return fail("expected_urls", ERROR_CODES.expected_urls, undefined, 400);
    }

    let upload: MediaUpload;
    if (inboxId) {
      const resolved = resolveInboxUpload(user, inboxId);
      if (!resolved) return fail("unknown_inbox_file", ERROR_CODES.unknown_inbox_file, undefined, 400);
      upload = resolved;
    } else {
      const limits = loadUserConfig(user).media;
      const fetched = await fetchMedia(fetchUrl!, { image: limits.imageBytes, video: limits.videoBytes });
      if (!fetched.ok) return fail("could_not_fetch", ERROR_CODES.could_not_fetch, [fetched.problem], 400);
      upload = fetched.media;
    }

    if (dryRun) return ok(previewOf(intent, upload.bytes.byteLength));

    const result = await storeMediaV2(user, intent, upload);
    if (!result.ok) return refuseWriteResult(result);
    // Only once the bytes have actually landed somewhere that is not this
    // same inbox entry — a photo whose trip was declined resolves right back
    // into the inbox under the same content-addressed id, and removing it
    // then would delete the very file this call just decided to leave there.
    if (inboxId && !result.item.src.startsWith("inbox:")) forgetInboxUpload(user, inboxId);
    return ok(result.item, { status: 201 });
  }

  // multipart/form-data — bytes under `file`, `intent` beside them as a JSON
  // string, per the schema's own doc comment.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > REQUEST_MAX_BYTES) {
    return fail(
      "body_too_large",
      `${ERROR_CODES.body_too_large} ${megabytes(declared)} over ${megabytes(REQUEST_MAX_BYTES)}.`,
      undefined,
      413,
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return fail("expected_multipart", ERROR_CODES.expected_multipart, undefined, 400);

  let intentJson: unknown;
  try {
    intentJson = JSON.parse(String(form.get("intent") ?? ""));
  } catch {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} \`intent\` must be a JSON-encoded form field.`, undefined, 400);
  }
  const intentParsed = mediaIntent.safeParse(intentJson);
  if (!intentParsed.success) {
    return fail(
      "invalid_request",
      `${ERROR_CODES.invalid_request} \`intent\` is not usable.`,
      intentParsed.error.issues.map((i) => ({ field: i.path.join(".") || "(intent)", problem: i.message })),
      400,
    );
  }
  const intent = intentParsed.data;

  const gated = await gateIntent(bearer.session, user, intent);
  if (gated) return gated;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail("expected_multipart", `${ERROR_CODES.expected_multipart} Send bytes under \`file\`.`, undefined, 400);
  }
  const bytes = Buffer.from(await file.arrayBuffer());

  if (dryRun) return ok(previewOf(intent, bytes.byteLength));

  const result = await storeMediaV2(user, intent, { filename: file.name, bytes });
  if (!result.ok) return refuseWriteResult(result);
  return ok(result.item, { status: 201 });
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/v2/[user]/media">) {
  const { user } = await params;
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const parsedBody = await readJson(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value;
  const src = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).src : undefined;
  if (typeof src !== "string" || !src) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} Send {"src": "..."} — the src an upload answered with.`, undefined, 400);
  }

  // Gated on what `src` names, not blanket owner-only: a trip-scoped token
  // may delete its own trip's photograph, the same write authority it has
  // over everything else on that trip. An `inbox:` src names nothing that
  // belongs to any one trip, so that half stays owner-only.
  if (src.startsWith("inbox:")) {
    if (!mayActAsOwner(bearer.session, user)) return ownerOnlyRefusal();
  } else {
    const tripId = mediaKey(src).split("/")[0];
    const trip = tripId ? getTrip(tripRef(user, tripId)) : undefined;
    if (!trip) return fail("unknown_media", ERROR_CODES.unknown_media, undefined, 404);
    const gate = await mayWriteTrip(bearer.session, trip);
    if (!gate.ok) return refuseTripGate(gate);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }
  if (dryRun) return ok({ ok: true, src, note: "dryRun — nothing was removed." });

  const result = deleteMediaV2(user, src);
  if (!result.ok) return fail("unknown_media", ERROR_CODES.unknown_media, undefined, 404);
  return ok({ ok: true, src });
}
