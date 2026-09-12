// GET/PUT/PATCH/DELETE one day — B1612 (phase 2 step 3, parcel B).
//
// schema.parse -> shared domain function -> full stored-document echo, same
// shape as the journal and trip document routes.
import type { ZodType } from "zod";
import { dayWrite, dayPatch, dayDoc, daySlug, DAY_DECLINABLES } from "@/lib/api/v2/schemas";
import { problemsFrom, splitIssues } from "@/lib/api/v2/incomplete";
import { etagFor, fail, ifMatchStale, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { DAY_IMMUTABLE_FIELDS, retractDeclines, stripEchoedFields } from "@/lib/api/v2/write";
import { resolveBearer, ownsUser, outOfScopeRefusal } from "@/lib/api/v2/auth";
import { mayWriteTrip, refuseWrite } from "@/lib/api/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readTripFile, readDayFile, writeDayFile, deleteDayFile } from "@/lib/api/v2/store";
import { stripMediaEcho, toStoredMedia, dayEchoInput, resolveStatusEcho } from "@/lib/api/v2/days";
import type { DayFile, TripFile } from "@/lib/api/v2/documents";
import type { Trip } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAY_DECLINABLE_FIELDS = DAY_DECLINABLES.map((d) => d.field);

type RouteCtx = RouteContext<"/api/v2/[user]/trips/[trip]/days/[slug]">;

function tripLike(user: string, tripId: string, trip: TripFile): Trip {
  return { username: user, id: tripId, ref: `${user}/${tripId}`, people: trip.people } as unknown as Trip;
}

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

export async function GET(request: Request, { params }: RouteCtx) {
  const { user, trip: tripId, slug } = await params;
  const gate = await gateTrip(request, user, tripId);
  if (!gate.ok) return gate.response;

  const day = readDayFile(user, tripId, slug);
  if (!day) return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);

  const doc = dayDoc.parse(dayEchoInput(day));
  return ok(doc, { etag: etagFor(doc) });
}

/**
 * Client-chosen slug (S2), and PUT is CREATE-ONLY (decision 7) — same shape
 * as the trip route: a slug that already exists answers 409 `stale_document`
 * with the stored document (a retried create, not a replace) unless the
 * caller sent a matching `If-Match`, which turns it into a deliberate
 * replace (V11).
 */
export async function PUT(request: Request, { params }: RouteCtx) {
  const { user, trip: tripId, slug } = await params;
  if (!daySlug.test(slug)) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} "${slug}" is not YYYY-MM-DD-slug.`, undefined, 400);
  }

  const gate = await gateTrip(request, user, tripId);
  if (!gate.ok) return gate.response;

  const stored = readDayFile(user, tripId, slug);
  if (stored) {
    const currentDoc = dayDoc.parse(dayEchoInput(stored));
    const currentEtag = etagFor(currentDoc);
    // PUT is create-only (decision 7): an id that already exists with no
    // `If-Match` is a retried create, not a replace, and is refused exactly
    // like a stale `If-Match` — both `stale_document`, both carrying the
    // stored document. Only a matching `If-Match` turns this into a
    // deliberate replace (V11). Matches the figures parcel's
    // `PUT .../figures/{id}` — same verb, same kind of client-chosen id.
    if (!request.headers.get("if-match") || ifMatchStale(request, currentEtag)) {
      return fail("stale_document", ERROR_CODES.stale_document, currentDoc, 409);
    }
    if (stored.status === "published") {
      // A published day still goes through PATCH for a correction (B266's
      // rule survives the storage change); replacing it wholesale via PUT
      // while it is on the site is refused rather than silently taking it
      // back to draft, which `dayWrite`'s own `status: "draft"`-only literal
      // would otherwise do as a side effect nobody asked for.
      return fail(
        "already_published",
        `"${slug}" is already published — PUT replaces a draft; PATCH it instead, or unpublish it first.`,
        currentDoc,
        409,
      );
    }
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} The body must be a JSON object.`, undefined, 400);
  }

  const mediaStripped = stripMediaEcho(body.value as Record<string, unknown>);
  const statusResolved = resolveStatusEcho(mediaStripped, stored?.status);
  if (!statusResolved.ok) return fail("invalid_request", statusResolved.message, undefined, 400);
  const stripped = stripEchoedFields(
    statusResolved.body,
    stored as unknown as Record<string, unknown> | null,
    DAY_IMMUTABLE_FIELDS,
  );
  if (!stripped.ok) return fail("invalid_request", stripped.message, undefined, 400);

  const raw = stripped.body;
  if (raw.slug !== undefined && raw.slug !== slug) {
    return fail(
      "invalid_request",
      `${ERROR_CODES.invalid_request} The slug in the body ("${String(raw.slug)}") does not match the URL ("${slug}").`,
      undefined,
      400,
    );
  }
  raw.slug = slug;

  const parsed = dayWrite.safeParse(raw);
  if (!parsed.success) {
    const shape = dayDoc.shape as unknown as Record<string, ZodType>;
    const { incomplete, problems } = splitIssues(parsed.error, shape);
    if (incomplete) return fail("incomplete", ERROR_CODES.incomplete, incomplete, 422);
    return fail("invalid_entry", ERROR_CODES.invalid_entry, problems, 400);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }

  const toWrite: DayFile = {
    ...parsed.data,
    status: "draft",
    media: toStoredMedia(parsed.data.media, stored?.media),
  };

  if (dryRun) {
    const preview = dayDoc.parse(dayEchoInput(toWrite));
    return ok(preview, { etag: etagFor(preview) });
  }

  writeDayFile(user, tripId, slug, toWrite);
  const echo = dayDoc.parse(dayEchoInput(toWrite));
  return ok(echo, { etag: etagFor(echo), status: stored ? 200 : 201 });
}

/**
 * Merge-patch (V2). Nothing is asked beyond what the patch raises; the
 * merged document is re-validated in full (`dayWrite`) so a day that was
 * complete stays provably complete after every change.
 */
export async function PATCH(request: Request, { params }: RouteCtx) {
  const { user, trip: tripId, slug } = await params;
  const gate = await gateTrip(request, user, tripId);
  if (!gate.ok) return gate.response;

  const stored = readDayFile(user, tripId, slug);
  if (!stored) return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);

  const currentDoc = dayDoc.parse(dayEchoInput(stored));
  const currentEtag = etagFor(currentDoc);
  if (ifMatchStale(request, currentEtag)) {
    return fail("stale_document", ERROR_CODES.stale_document, currentDoc, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} The body must be a JSON object.`, undefined, 400);
  }

  const mediaStripped = stripMediaEcho(body.value as Record<string, unknown>);
  const statusResolved = resolveStatusEcho(mediaStripped, stored.status);
  if (!statusResolved.ok) return fail("invalid_request", statusResolved.message, undefined, 400);
  const stripped = stripEchoedFields(
    statusResolved.body,
    stored as unknown as Record<string, unknown>,
    DAY_IMMUTABLE_FIELDS,
  );
  if (!stripped.ok) return fail("invalid_request", stripped.message, undefined, 400);

  const patchParsed = dayPatch.safeParse(stripped.body);
  if (!patchParsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(patchParsed.error), 400);
  }
  const patch = patchParsed.data as Record<string, unknown>;

  const storedWritable: Record<string, unknown> = { ...(stored as Record<string, unknown>), status: "draft" };

  const retracted = retractDeclines(patch, storedWritable.declined as Record<string, string> | undefined, DAY_DECLINABLE_FIELDS);
  const declinedMerged: Record<string, string> = {
    ...(retracted ?? {}),
    ...((patch.declined as Record<string, string> | undefined) ?? {}),
  };

  const merged: Record<string, unknown> = { ...storedWritable, ...patch };
  if (Object.keys(declinedMerged).length > 0) merged.declined = declinedMerged;
  else delete merged.declined;

  const finalParsed = dayWrite.safeParse(merged);
  if (!finalParsed.success) {
    const shape = dayDoc.shape as unknown as Record<string, ZodType>;
    const { incomplete, problems } = splitIssues(finalParsed.error, shape);
    if (incomplete) return fail("incomplete", ERROR_CODES.incomplete, incomplete, 422);
    return fail("invalid_entry", ERROR_CODES.invalid_entry, problems, 400);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }

  const toWrite: DayFile = {
    ...finalParsed.data,
    status: stored.status, // PATCH never moves a day between draft and published (B266's rule).
    media: toStoredMedia(finalParsed.data.media, stored.media),
  };

  if (dryRun) {
    const preview = dayDoc.parse(dayEchoInput(toWrite));
    return ok(preview, { etag: etagFor(preview) });
  }

  writeDayFile(user, tripId, slug, toWrite);
  const echo = dayDoc.parse(dayEchoInput(toWrite));
  return ok(echo, { etag: etagFor(echo) });
}

/**
 * `published_day_not_deletable` stands: destroying something people have
 * already read is not a self-served step (B1118's doctrine, carried over
 * unchanged). Take it off the site with `.../unpublish` first, which is
 * reversible; once it is a draft again, this deletes it outright — no
 * confirmation handshake, since nothing here has ever been on the site.
 */
export async function DELETE(request: Request, { params }: RouteCtx) {
  const { user, trip: tripId, slug } = await params;
  const gate = await gateTrip(request, user, tripId);
  if (!gate.ok) return gate.response;

  const day = readDayFile(user, tripId, slug);
  if (!day) return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);

  if (day.status === "published") {
    return fail(
      "published_day_not_deletable",
      `${ERROR_CODES.published_day_not_deletable} Unpublish it first: POST .../trips/${tripId}/days/${slug}/unpublish.`,
      undefined,
      409,
    );
  }

  deleteDayFile(user, tripId, slug);
  return ok({
    ok: true,
    slug,
    deleted: true,
    published: false,
    mediaKept: true,
    note: "The day file is deleted. Its photographs are still on disk under the trip's media folder — removing those is a person's job.",
  });
}
