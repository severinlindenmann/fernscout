import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { createDraft, deleteEntry, entrySummary, isPublished, type DraftInput } from "@/lib/api/entries";
import { confirmationMatches, confirmationRequired } from "@/lib/agentConfirm";
import { getAllEntries } from "@/lib/entries";
// Shared with MCP's create_day. The module lives under lib/mcp/ because that
// is where it was needed first; the mechanism is not MCP's.
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/mcp/idempotency";
import { getTrip, tripRef } from "@/lib/trips";
import { validateEntry } from "@/lib/validate/entry";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  // One answer for "no such trip" and "not yours". Answering 403 for the trips
  // that exist and 404 for the ones that do not let a token scoped to one trip
  // enumerate the journal's others by guessing ids — and /agent.md promises
  // they "answer as if it did not exist". MCP already did this correctly.
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  return Response.json({ trip: ref, days: getAllEntries(ref).map(entrySummary) });
}

/**
 * Write a day.
 *
 * Always a draft. There is no parameter that publishes, and adding one would
 * remove the only thing standing between a generated memory and your family
 * reading it as fact.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  // Checked before the body is read, and answering the same way for a trip
  // that does not exist as for one that is not yours — see the GET above.
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  const body = (await request.json().catch(() => null)) as Partial<DraftInput> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  // Every problem at once, named and with what was expected — not the first
  // one, and not a 500 from a malformed cost line further down the pipeline.
  const problems = validateEntry(body);
  if (problems.length > 0) {
    return Response.json({ error: "invalid_entry", problems }, { status: 400 });
  }

  /**
   * `idempotency_key`, the same mechanism MCP's `create_day` has.
   *
   * It was documented only under MCP, which left an agent using REST unable to
   * tell whether sending one would be honoured, ignored, or rejected — so the
   * advice to "pass one on every write" could not be followed here. It is
   * honoured, with the same semantics: the same key with the same arguments
   * replays the first answer; the same key with *different* arguments is
   * refused and nothing is written, because answering a new day with an old
   * day's result is a failure an agent has no way to notice.
   *
   * Shared with the MCP path rather than reimplemented — one door's retry
   * behaviour differing from the other's would be its own surprise.
   */
  const supplied = typeof body.idempotency_key === "string" ? body.idempotency_key : undefined;
  const key = supplied ? idempotencyKey(user, "create_day", supplied) : null;
  const fingerprint = fingerprintOf({ ...body, trip: ref });
  const previous = recall<{ slug: string; status: string }>(key, fingerprint);

  if (previous.kind === "conflict") {
    return Response.json(
      {
        error: "idempotency_key_reused",
        message:
          `idempotency_key ${JSON.stringify(supplied)} was already used for a different day, ` +
          "so nothing was written. The key identifies one write, not your session: reuse it " +
          "only to retry the same call after a dropped connection. For a new day, send a new key.",
      },
      { status: 409 },
    );
  }
  if (previous.kind === "replay") {
    return Response.json(
      {
        ok: true,
        ...previous.value,
        replayed: true,
        note:
          "This idempotency_key was already used for this same call. The day below is the one " +
          "written then; nothing was written again.",
      },
      { status: 200 },
    );
  }

  const result = createDraft(ref, body as DraftInput);
  if (!result.ok) {
    // A retry that finds its own earlier write is a conflict, not a failure:
    // agents retry, and the second attempt must not overwrite the first.
    const status = result.error.startsWith("an entry already exists") ? 409 : 400;
    return Response.json({ error: result.error }, { status });
  }

  const written = { slug: result.slug, status: result.status };
  remember(key, fingerprint, written);

  return Response.json(
    {
      ok: true,
      ...written,
      note: "Created as a draft. It is not on the site until a person publishes it.",
    },
    { status: 201 },
  );
}

/**
 * Delete a draft — behind a confirmation code.
 *
 * The first call is always refused, whatever it carries, and answers with a
 * code bound to this exact day. The agent repeats the call with it. That is
 * the whole mechanism, and the reason it is a server-issued code rather than
 * an `"are_you_sure": true` field is that an agent can set a field.
 *
 * Only drafts. A published day is somebody's family reading about a place
 * they went; removing one is a person's job, with `rm`, in a folder they own.
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  // The verb depends on what is being deleted, and the verb is signed — so a
  // code issued to tidy away an unpublished scrap cannot remove a day people
  // have already read. An agent that drifts from one to the other is refused
  // again and reads a different, more serious sentence.
  const published = isPublished(ref, slug);
  const operation = {
    action: published ? ("delete_published" as const) : ("delete_draft" as const),
    scope: ref,
    target: slug,
  };
  const confirm = typeof body?.confirm === "string" ? body.confirm : undefined;
  if (!confirmationMatches(confirm, operation)) {
    return Response.json(
      confirmationRequired(
        operation,
        published
          ? `This permanently deletes "${slug}", which is PUBLISHED — anyone following ` +
              `a link to it, or reading the feed, has already seen it. It cannot be undone ` +
              `from here. Its photographs stay on disk and are not deleted with it.`
          : `This permanently deletes the draft "${slug}". Its photographs stay on disk ` +
              `and are not deleted with it.`,
      ),
      { status: 409 },
    );
  }

  const result = deleteEntry(ref, slug, { allowPublished: true });
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  // `mediaKept` because an agent that has just deleted a day will otherwise
  // report the photographs gone too, and they are not: the entry file is
  // removed and its media folder is left exactly where it was, so a day
  // deleted by mistake can be written again around the same pictures.
  return Response.json({
    ok: true,
    slug: result.slug,
    deleted: true,
    published: result.published,
    mediaKept: true,
    note: "The entry file is deleted. Its photographs are still on disk under the trip's media folder — removing those is a person's job.",
  });
}
