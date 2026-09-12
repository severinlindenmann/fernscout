import { getUser } from "@/lib/users";
import { ID_RE } from "@/lib/tripWrite";
import { figureDoc } from "@/lib/api/v2/schemas";
import {
  deleteFigureDoc,
  figureReferences,
  getFigureDoc,
  writeFigureDoc,
} from "@/lib/figures";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { etagFor, fail, ifMatchStale, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";

export const dynamic = "force-dynamic";

/**
 * `GET/PUT/DELETE /api/v2/{user}/figures/{id}` — one figure in the journal's
 * library. Owner only (see `requireJournalOwner`): a figure may carry
 * `person`, an email, which is not public the way `.../presets` is.
 *
 * Next resolves the static siblings `figures/presets` and `figures/preview`
 * before this dynamic segment, so a request for either of those never
 * reaches this file at all — `test/api-v2-figures.test.ts` proves the two
 * handlers are functionally independent (this route would happily serve a
 * figure literally named "presets"; the presets route never looks at the
 * library to answer), which is the part a unit test *can* check without
 * booting a real server for the routing guarantee itself.
 *
 * `figureDoc` has no declinable sections (every field but `id` is a plain
 * optional), so there is no 422 `incomplete` case here — a malformed body is
 * always the ordinary `invalid_request` refusal, `problems` and all.
 */

function badId(id: string): Response | null {
  if (ID_RE.test(id)) return null;
  return fail(
    "invalid_request",
    'A figure id must be lowercase words joined by hyphens, e.g. "me-in-winter".',
  );
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/figures/[id]">,
) {
  const { user, id } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);

  const idError = badId(id);
  if (idError) return idError;

  const doc = getFigureDoc(user, id);
  if (!doc) return fail("not_found", `No figure "${id}" in this journal's library.`, undefined, 404);

  return ok(doc, { etag: etagFor(doc) });
}

/**
 * PUT is the create door (S2/V10) — client-chosen id. A retried create (no
 * `If-Match`, and an id that already exists) answers `stale_document` (409)
 * with the stored document, rather than silently overwriting it: sending
 * `If-Match` with the current document's own ETag is how a caller states "I
 * have read this and mean to replace it" — the same precondition V11 already
 * gives every v2 document GET. So a genuine edit is GET (read the ETag),
 * then PUT with `If-Match: "<etag>"`; without that header a second PUT to an
 * existing id cannot be told apart from a client blindly retrying its
 * original create, and this refuses it the same shape `trip_exists` refuses
 * one for a trip.
 */
export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/figures/[id]">,
) {
  const { user, id } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);

  const idError = badId(id);
  if (idError) return idError;

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", "dryRun must be true or false (or the query left out entirely).");
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(
      "invalid_request",
      "The body must be a figure document — see GET .../figures/presets for the shape.",
    );
  }
  const bodyId = (body as Record<string, unknown>).id;
  if (bodyId !== undefined && bodyId !== id) {
    return fail(
      "invalid_request",
      `The body's "id" ("${String(bodyId)}") must match the URL ("${id}"), or be left out.`,
    );
  }

  const result = figureDoc.safeParse({ ...(body as Record<string, unknown>), id });
  if (!result.success) {
    return fail("invalid_request", "This figure document is not usable.", {
      problems: problemsFrom(result.error),
    });
  }

  const existing = getFigureDoc(user, id);
  if (existing) {
    const ifMatch = request.headers.get("if-match");
    if (!ifMatch) {
      // An ordinary client-chosen-id create, retried (S2) — refuse rather
      // than replace what is already there.
      return fail(
        "stale_document",
        "A figure with this id is already in the library. Read it back, then PUT again " +
          "with If-Match set to its ETag if you meant to replace it.",
        { current: existing },
        409,
      );
    }
    if (ifMatchStale(request, etagFor(existing))) {
      return fail("stale_document", "This figure changed since it was last read.", { current: existing }, 409);
    }
    if (dryRun) return ok(result.data);
    writeFigureDoc(user, result.data);
    return ok(result.data, { etag: etagFor(result.data) });
  }

  if (dryRun) return ok(result.data, { status: 201 });
  writeFigureDoc(user, result.data);
  return ok(result.data, { status: 201, etag: etagFor(result.data) });
}

export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/figures/[id]">,
) {
  const { user, id } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);

  const idError = badId(id);
  if (idError) return idError;

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", "dryRun must be true or false (or the query left out entirely).");
  }

  const doc = getFigureDoc(user, id);
  if (!doc) return fail("not_found", `No figure "${id}" in this journal's library.`, undefined, 404);

  if (dryRun) {
    const referencedBy = figureReferences(user, id);
    if (referencedBy.journal || referencedBy.trips.length > 0) {
      return refuseReferenced(id, referencedBy);
    }
    return ok({ deleted: id, dryRun: true });
  }

  const result = deleteFigureDoc(user, id);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return fail("not_found", `No figure "${id}" in this journal's library.`, undefined, 404);
    }
    return refuseReferenced(id, result.referencedBy);
  }

  return ok({ deleted: id });
}

function refuseReferenced(
  id: string,
  referencedBy: { journal: boolean; trips: string[] },
): Response {
  const parts: string[] = [];
  if (referencedBy.journal) parts.push("the journal's own default figures");
  if (referencedBy.trips.length > 0) {
    parts.push(`${referencedBy.trips.length} trip(s): ${referencedBy.trips.join(", ")}`);
  }
  return fail(
    "figure_referenced",
    `"${id}" is still named in ${parts.join(" and ")}. Remove it there first, then delete it again.`,
    referencedBy,
    409,
  );
}
