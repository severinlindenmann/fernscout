// GET/PUT/PATCH/DELETE one trip — B1612 (phase 2 step 3, parcel B).
//
// schema.parse -> shared domain function -> full stored-document echo, same
// shape as app/api/v2/[user]/route.ts (the journal document route this is
// modelled on).
import type { ZodType } from "zod";
import { tripCreate, tripPatch, tripDoc, TRIP_DECLINABLE_KEYS } from "@/lib/api/v2/schemas";
import { tripId as tripIdSchema } from "@/lib/api/v2/schemas/shared";
import { problemsFrom, splitIssues } from "@/lib/api/v2/incomplete";
import { etagFor, fail, ifMatchStale, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import {
  TRIP_IMMUTABLE_FIELDS,
  applyNullClears,
  checkCover,
  checkTranslations,
  clearDeclinedSections,
  reconcileVisibility,
  retractAnsweredDeclines,
  retractDeclines,
  stripEchoedFields,
} from "@/lib/api/v2/write";
import {
  mayActAsOwner,
  ownerOnlyRefusal,
  outOfScopeRefusal,
  ownsUser,
  resolveBearer,
} from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { skillDocPath } from "@/lib/api/skillDocMeta";
import { serverSite } from "@/lib/site";
import { readTripFile, writeTripFile, writeDayFile } from "@/lib/api/v2/store";
import { toStoredMedia } from "@/lib/api/v2/days";
import { buildTripDoc, notifyNewPeople, tripDays } from "@/lib/api/v2/trips";
import type { TripFile } from "@/lib/api/v2/documents";
import { DELETION_TTL_MINUTES, humanBytes, requestDeletion } from "@/lib/deletions";
import { tripTombstone } from "@/lib/tombstones";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

type RouteCtx = RouteContext<"/api/v2/[user]/trips/[trip]">;

function daysModeOf(request: Request): "full" | "summaries" | "none" {
  const raw = new URL(request.url).searchParams.get("days");
  return raw === "summaries" || raw === "none" ? raw : "full";
}

export async function GET(request: Request, { params }: RouteCtx) {
  const { user, trip } = await params;
  // Authenticate BEFORE resolving the journal — B1615. The other order lets
  // an anonymous caller tell `404 no_such_journal` from `401 missing_token`
  // and so enumerate usernames, which v1 never allowed and which `guest`
  // journals exist specifically to prevent: an instance that does not
  // advertise a journal must not answer for it either.
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  const stored = readTripFile(user, trip);
  if (!stored) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);

  const doc = buildTripDoc(user, trip, stored, daysModeOf(request));
  return ok(doc, { etag: etagFor(doc) });
}

/**
 * Client-chosen id (S2), and PUT is CREATE-ONLY (decision 7). A trip that
 * does not exist yet is created from the whole `tripCreate` document; one
 * that already exists answers 409 `stale_document` with the stored document
 * — a retried create, not a replace — UNLESS the caller sent a matching
 * `If-Match`, which is what turns it into a deliberate replace (V11's
 * mechanism doing exactly what it is for: the caller has read the document,
 * holds its etag, and is saying "replace the thing I read").
 */
export async function PUT(request: Request, { params }: RouteCtx) {
  const { user, trip } = await params;
  // Authenticate BEFORE resolving the journal — B1615. The other order lets
  // an anonymous caller tell `404 no_such_journal` from `401 missing_token`
  // and so enumerate usernames, which v1 never allowed and which `guest`
  // journals exist specifically to prevent: an instance that does not
  // advertise a journal must not answer for it either.
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  const journal = getUser(user);
  if (!journal) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  if (!mayActAsOwner(bearer.session, user)) return ownerOnlyRefusal();

  if (!tripIdSchema.safeParse(trip).success) {
    return fail("invalid_request", ERROR_CODES.invalid_trip_id, undefined, 400);
  }

  const stored = readTripFile(user, trip);

  /**
   * PUT is create-only (decision 7, `shared.ts`'s own comment on `tripId`:
   * "a retried create answers 409 with the stored document, so no write
   * needs idempotency machinery"). An id that already exists and no
   * `If-Match` reads as a retried create, not a replace — refused the same
   * way a stale `If-Match` is, both `stale_document`, both carrying the
   * stored document. A matching `If-Match` is the one thing that turns this
   * into a deliberate replace: the caller has read the document, holds its
   * etag, and is saying "replace the thing I read" (V11 doing exactly what
   * it is for). Matches the figures parcel's `PUT .../figures/{id}` — the
   * same verb on the same kind of client-chosen id must not answer
   * differently there and here.
   */
  const currentDoc = stored ? buildTripDoc(user, trip, stored, "full") : null;
  if (currentDoc) {
    const currentEtag = etagFor(currentDoc);
    // `ifMatchStale` alone answers "not stale" for an ABSENT header (PATCH's
    // last-write-wins default) — the opposite of what a PUT-to-an-existing-id
    // needs: here, no `If-Match` at all means the caller does not know this
    // exists, which is exactly the retried-create case decision 7 refuses.
    if (!request.headers.get("if-match") || ifMatchStale(request, currentEtag)) {
      return fail("stale_document", ERROR_CODES.stale_document, currentDoc, 409);
    }
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} The body must be a JSON object.`, undefined, 400);
  }

  // Compared against the FULL built doc, not the raw stored file: `status`
  // and `track` are computed at read time and never stored on a `TripFile`
  // at all, so a comparison against the raw file could never recognise an
  // echo of either as byte-identical — every GET-then-PUT round trip would
  // be refused for two keys the caller never chose to send.
  const stripped = stripEchoedFields(
    body.value as Record<string, unknown>,
    currentDoc as unknown as Record<string, unknown> | null,
    TRIP_IMMUTABLE_FIELDS,
  );
  if (!stripped.ok) return fail("invalid_request", stripped.message, undefined, 400);

  const raw = stripped.body;
  if (raw.id !== undefined && raw.id !== trip) {
    return fail(
      "invalid_request",
      `${ERROR_CODES.invalid_request} The trip id in the body ("${String(raw.id)}") does not match the URL ("${trip}").`,
      undefined,
      400,
    );
  }
  raw.id = trip;

  /**
   * `days` on a REPLACE (stored already exists): a day changes through its
   * own slug route, the same invariant `tripPatch` enforces by refusing the
   * key outright (trip.ts). Refusing it here too would break the echo-
   * tolerance property this ticket's acceptance list names (GET returns the
   * full `days: dayDoc[]`, and PUTting the whole document back has to work)
   * — so on replace this key is dropped rather than validated, and the
   * `days` declinable is answered on the caller's behalf with a fixed reason
   * unless they already answered it themselves. Not a schema change: this is
   * route-level handling of a field the schema still fully asks about on
   * CREATE, where it is a genuine question (a brand new trip has no days on
   * disk to conflict with).
   */
  if (stored) {
    delete raw.days;
    const declined = (raw.declined as Record<string, string> | undefined) ?? {};
    if (declined.days === undefined) {
      raw.declined = { ...declined, days: "days are written and changed through their own route, not re-asked on a trip replace" };
    }
  }

  const parsed = tripCreate.safeParse(raw);
  if (!parsed.success) {
    const shape = tripDoc.shape as unknown as Record<string, ZodType>;
    const { incomplete, problems } = splitIssues(parsed.error, shape);
    if (incomplete) return fail("incomplete", ERROR_CODES.incomplete, incomplete, 422);
    return fail("invalid_trip", ERROR_CODES.invalid_trip, problems, 400);
  }

  // B1625/B1619 — a translation naming a locale this journal does not
  // declare, the journal's own language duplicated under translations, or a
  // translations map missing a language the journal is owed. A Zod schema
  // cannot see the journal's config, so this check lives at the door
  // (00-decisions.md), shared with the day route below.
  const localeProblem = checkTranslations(parsed.data.translations, journal.locales, journal.defaultLocale);
  if (localeProblem?.kind === "invalid") {
    return fail("invalid_translations", localeProblem.message, localeProblem.problems, 400);
  }
  if (localeProblem?.kind === "incomplete") {
    return fail("incomplete", ERROR_CODES.incomplete, { missing: localeProblem.missing }, 422);
  }

  // B1626 — `cover` must name a `src` this trip's own gallery already
  // carries. On a REPLACE `raw.days` was deleted above (a day changes
  // through its own route), so the media that counts is what is already on
  // disk; on a genuine create the only media that can exist yet is what this
  // same call is writing inline.
  const coverMediaSrcs = new Set<string>(
    (stored ? tripDays(user, trip) : (parsed.data.days ?? [])).flatMap((d) => (d.media ?? []).map((m) => m.src)),
  );
  const coverProblem = checkCover(parsed.data.cover, coverMediaSrcs);
  if (coverProblem) return fail("invalid_cover", coverProblem, undefined, 400);

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }

  const { days: initialDays, ...tripFields } = parsed.data;
  const toWrite: TripFile = tripFields;

  if (dryRun) {
    const preview = buildTripDoc(user, trip, toWrite, "full");
    return ok(preview, { etag: etagFor(preview) });
  }

  const before = stored?.people.map((p) => p.email) ?? [];
  writeTripFile(user, trip, toWrite);

  // Days supplied inline at CREATE (the trip's own `days` declinable,
  // genuinely askable only here — see the comment above) are written as
  // their own documents, exactly as `PUT .../days/{slug}` would.
  if (!stored && initialDays) {
    for (const day of initialDays) {
      writeDayFile(user, trip, day.slug, {
        ...day,
        status: "draft",
        media: toStoredMedia(day.media, undefined),
      });
    }
  }

  const notifications = await notifyNewPeople(user, toWrite.title, toWrite.people, before);

  const echo = buildTripDoc(user, trip, toWrite, "full");
  const withNotifications = notifications.length > 0 ? { ...(echo as Record<string, unknown>), notifications } : echo;
  // A create tells the agent where the next step is written down — B311's
  // chain, journal → trip → day → photos. v1's own create routes carried this
  // and v2's did not, so an agent that had just made its first trip was left
  // to guess; `/documentation.txt` and the /skill guides are the whole product
  // for anybody not standing in this checkout. Only on a create: a correction
  // is not somebody's first time. B1621.
  const echoBody = stored
    ? withNotifications
    : {
        ...withNotifications,
        next:
          `PUT /api/v2/${user}/trips/${trip}/days/<slug> to write the first day — ` +
          `${serverSite().url}${skillDocPath("add-a-day")} is what it takes.`,
      };
  return ok(echoBody, { etag: etagFor(echo), status: stored ? 200 : 201 });
}

/**
 * Merge-patch (V2). Nothing is asked beyond what the patch itself raises —
 * `checkPatchConflicts` in the schema catches a field both supplied and
 * declined in the SAME call; T6 (below) catches a field that supplies what a
 * PREVIOUS call declined. The merged document is re-validated in full
 * (`tripCreate`, same as the journal PATCH route) so a journal that somehow
 * has an incomplete stored trip is told so the first time anything about it
 * changes, rather than silently accepted.
 */
export async function PATCH(request: Request, { params }: RouteCtx) {
  const { user, trip } = await params;
  // Authenticate BEFORE resolving the journal — B1615. The other order lets
  // an anonymous caller tell `404 no_such_journal` from `401 missing_token`
  // and so enumerate usernames, which v1 never allowed and which `guest`
  // journals exist specifically to prevent: an instance that does not
  // advertise a journal must not answer for it either.
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  const journal = getUser(user);
  if (!journal) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  if (!mayActAsOwner(bearer.session, user)) return ownerOnlyRefusal();

  const stored = readTripFile(user, trip);
  if (!stored) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);

  const currentDoc = buildTripDoc(user, trip, stored, "full");
  const currentEtag = etagFor(currentDoc);
  if (ifMatchStale(request, currentEtag)) {
    return fail("stale_document", ERROR_CODES.stale_document, currentDoc, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} The body must be a JSON object.`, undefined, 400);
  }

  // Compared against the FULL built doc, not the raw stored file — same
  // reason as PUT's own comment above: `status` and `track` exist only on
  // the built doc, never on a `TripFile`.
  const stripped = stripEchoedFields(
    body.value as Record<string, unknown>,
    currentDoc as unknown as Record<string, unknown>,
    TRIP_IMMUTABLE_FIELDS,
  );
  if (!stripped.ok) return fail("invalid_request", stripped.message, undefined, 400);

  const patchParsed = tripPatch.safeParse(stripped.body);
  if (!patchParsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(patchParsed.error), 400);
  }
  const patch = patchParsed.data as Record<string, unknown>;

  const storedWritable: Record<string, unknown> = { ...(stored as Record<string, unknown>), id: trip };

  const retracted = retractDeclines(patch, storedWritable.declined as Record<string, string> | undefined, TRIP_DECLINABLE_KEYS);
  const declinedMerged: Record<string, string> = {
    ...(retracted ?? {}),
    ...((patch.declined as Record<string, string> | undefined) ?? {}),
  };

  const merged: Record<string, unknown> = { ...storedWritable, ...patch };
  if (Object.keys(declinedMerged).length > 0) merged.declined = declinedMerged;
  else delete merged.declined;

  // B1631 — T6's mirror: a section this patch DECLINES loses its stored
  // value in the same call, so the merged document is never asked to hold
  // both at once.
  clearDeclinedSections(merged, patch.declined as Record<string, string> | undefined);

  // D11 — a patch's `null` on `cover`/`accent`/`tagline`/`intro` removes the
  // field. Applied to the MERGED document, after the spread above (which
  // would otherwise leave the literal `null` sitting in place of the stored
  // value) and after `retractDeclines`/`checkPatchConflicts` have already
  // seen the incoming `null` as "this field is being answered" — deleting it
  // any earlier would make a `{field: null, declined: {field: "…"}}` patch
  // look like a silent omission instead of a deliberate swap.
  applyNullClears(merged);

  // B1616 — two dead ends this merge alone cannot avoid. `buddies` has no
  // real field of its own for T6 above to key on, so a solo trip's
  // `declined.buddies` survives a patch that grows `people` past one unless
  // something else notices; and a stored `listed`/`teaser` survives a patch
  // that moves `visibility` across the public/closed line, because merge-
  // patch has no way to un-send a key by omitting it. Both belong here,
  // after the merge (this is the first point the route holds old-and-new
  // together) and before `tripCreate` revalidates the result.
  retractAnsweredDeclines(merged, patch);
  reconcileVisibility(merged, patch);

  /**
   * `days` is never in `merged` here — `tripPatch`'s own `superRefine`
   * already refused a patch that names it (a day changes through its own
   * route), and `storedWritable` never carries one either (`trip.json`
   * never stores `days`). `tripCreate` still asks about `days` as a
   * declinable, because a BRAND NEW trip genuinely has none yet to conflict
   * with — but an EXISTING trip has already answered that question one way
   * or the other at create time, and the answer is not re-askable through a
   * document that no longer carries it. So the same fixed decline `PUT`'s
   * replace path injects is injected here too, once, unless the trip's own
   * `declined.days` already covers it.
   */
  if (merged.days === undefined) {
    const declined = (merged.declined as Record<string, string> | undefined) ?? {};
    if (declined.days === undefined) {
      merged.declined = { ...declined, days: "days are written and changed through their own route, not re-asked once a trip exists" };
    }
  }

  /**
   * `cover` once the trip holds media — the one conditional question
   * `tripCreate`'s own schema cannot ask, because it cannot see what is
   * stored (trip.ts's own comment: "the route asks it on update once the
   * trip holds media"). A trip with at least one photograph on any day, no
   * `cover` and no `declined.cover`, is asked here rather than silently
   * defaulting — the auto-pick only happens once the question has actually
   * been declined.
   */
  const hasMedia = tripDays(user, trip).some((d) => d.media && d.media.length > 0);
  if (hasMedia && merged.cover === undefined && (merged.declined as Record<string, string> | undefined)?.cover === undefined) {
    return fail(
      "incomplete",
      ERROR_CODES.incomplete,
      {
        missing: [
          {
            field: "cover",
            why_required: "this trip now has photographs — pick one as the card's cover, or decline and let the newest stand in",
            to_provide: { type: "string", description: "a media src already on this trip" },
            to_decline: "declined.cover: <reason>",
          },
        ],
      },
      422,
    );
  }

  delete merged.days; // a day changes through its own route, whatever the patch names.

  const finalParsed = tripCreate.safeParse(merged);
  if (!finalParsed.success) {
    const shape = tripDoc.shape as unknown as Record<string, ZodType>;
    const { incomplete, problems } = splitIssues(finalParsed.error, shape);
    if (incomplete) return fail("incomplete", ERROR_CODES.incomplete, incomplete, 422);
    return fail("invalid_request", ERROR_CODES.invalid_request, problems, 400);
  }

  // B1625/B1619/B1626 — the same door checks the PUT route runs, against the
  // merged document a patch produces. Media is whatever the trip already has
  // on disk: a PATCH never writes `days` (see above).
  const localeProblem = checkTranslations(finalParsed.data.translations, journal.locales, journal.defaultLocale);
  if (localeProblem?.kind === "invalid") {
    return fail("invalid_translations", localeProblem.message, localeProblem.problems, 400);
  }
  if (localeProblem?.kind === "incomplete") {
    return fail("incomplete", ERROR_CODES.incomplete, { missing: localeProblem.missing }, 422);
  }

  const coverMediaSrcs = new Set<string>(tripDays(user, trip).flatMap((d) => (d.media ?? []).map((m) => m.src)));
  const coverProblem = checkCover(finalParsed.data.cover, coverMediaSrcs);
  if (coverProblem) return fail("invalid_cover", coverProblem, undefined, 400);

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }

  const { days: _ignored, ...tripFields } = finalParsed.data;
  const toWrite: TripFile = tripFields;

  if (dryRun) {
    const preview = buildTripDoc(user, trip, toWrite, "full");
    return ok(preview, { etag: etagFor(preview) });
  }

  const before = stored.people.map((p) => p.email);
  writeTripFile(user, trip, toWrite);
  const notifications = await notifyNewPeople(user, toWrite.title, toWrite.people, before);

  const echo = buildTripDoc(user, trip, toWrite, "full");
  const withNotifications = notifications.length > 0 ? { ...(echo as Record<string, unknown>), notifications } : echo;
  return ok(withNotifications, { etag: etagFor(echo) });
}

/**
 * Ask to delete a trip — 202, a mail, and nothing removed here. Same
 * mechanism as `app/api/v2/[user]/route.ts`'s journal DELETE and unchanged
 * per rule 9: the second step happens in a mailbox, never on a bearer token.
 */
export async function DELETE(request: Request, { params }: RouteCtx) {
  const { user, trip } = await params;

  const stone = tripTombstone(user, trip);
  if (stone && !readTripFile(user, trip)) {
    return fail("gone", `"${trip}" was deleted on ${stone.deletedAt.slice(0, 10)}. There is nothing left to delete.`, undefined, 410);
  }

  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  if (!mayActAsOwner(bearer.session, user)) return ownerOnlyRefusal();

  const asked = await requestDeletion({ kind: "trip", username: user, tripId: trip }, { sessionId: bearer.session.id });
  if (!asked.ok) {
    return fail(asked.error as Parameters<typeof fail>[0], asked.message, undefined, asked.status);
  }

  const { summary } = asked;
  return ok(
    {
      ok: true,
      deleted: false,
      status: "confirmation_sent",
      mailedTo: asked.email,
      expires: asked.expiresAt,
      willDelete: {
        trip: summary.title,
        id: trip,
        days: summary.days,
        files: summary.files,
        size: humanBytes(summary.bytes),
        mediaGoesToo: true,
      },
      note:
        "NOTHING HAS BEEN DELETED. A mail has gone to the address that owns this journal " +
        `(${asked.email}) with a link to a page that asks once more and has a button on it. ` +
        `The link works for ${DELETION_TTL_MINUTES} minutes and once only. Unlike deleting a day, ` +
        "deleting a trip takes its photographs with it — say that when you report what is about " +
        "to happen.",
      next: `Tell the person a mail is waiting at ${asked.email}, and that the trip is still there until they open it and press the button. Do not report this as deleted.`,
    },
    { status: 202 },
  );
}
