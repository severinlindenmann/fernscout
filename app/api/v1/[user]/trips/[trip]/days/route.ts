import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { createDraft, deleteEntry, entrySummary, isPublished, type DraftInput } from "@/lib/api/entries";
import { confirmationMatches, confirmationRequired } from "@/lib/agentConfirm";
import { getAllEntries } from "@/lib/entries";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { getTrip, tripRef } from "@/lib/trips";
import { validateEntry } from "@/lib/validate/entry";

import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The journal's declared languages, for B294's completeness refusal.
 *
 * `locales` is what a reader may switch into and `defaultLocale` is the
 * language the prose itself is in — so a day owes a translation for every
 * locale except that one. Read per request rather than cached: an owner can
 * change both with one `PATCH .../config` (B220), and a day written a minute
 * later must be judged against what the journal says now.
 */
function languagesOf(user: string): { locales: readonly string[]; writtenLocale: string } | undefined {
  const journal = getUser(user);
  if (!journal) return undefined;
  return { locales: journal.locales, writtenLocale: journal.defaultLocale };
}


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
  // they "answer as if it did not exist".
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  /**
   * The trip is handed to `entrySummary` so each day can say whether it is
   * content nobody lived — B116.
   *
   * It matters for one invented day inside an otherwise real trip, which the
   * software allows and which this list is exactly where an agent would go
   * looking for. Inherited too: a day in a `test` trip carries no flag of its
   * own, and `GET .../days/<slug>` has resolved it that way since B47, so the
   * list and the day read must not disagree about the same day.
   *
   * `includeDrafts: true` — the gate above already establishes the caller may
   * see them: owner, or somebody on the trip. Everything this API writes
   * lands as a draft, so without this an agent that had just created fifteen
   * days asked for the trip's days and was handed an empty array (B296).
   * `entrySummary` marks which is which so the two are not confused.
   */
  return Response.json({
    trip: ref,
    days: getAllEntries(ref, { includeDrafts: true }).map((entry) => entrySummary(entry, found)),
  });
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
  const problems = validateEntry(body, languagesOf(user));
  if (problems.length > 0) {
    return Response.json({ error: "invalid_entry", problems }, { status: 400 });
  }

  /**
   * `idempotency_key` — an optional field an agent sends to make a retry
   * safe. The same key with the same arguments replays the first answer; the
   * same key with *different* arguments is refused and nothing is written,
   * because answering a new day with an old day's result is a failure an
   * agent has no way to notice.
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
          `idempotency_key ${JSON.stringify(supplied)} was already used for a different day. ` +
          `That write succeeded — it created "${previous.value.slug}" — and nothing was written ` +
          "this time. The key identifies one write, not your session: reuse it only to retry " +
          "the same call after a dropped connection. For a new day, send a new key.",
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
    //
    // `bug` is the read-back failing (B208), and it is 500 rather than 400
    // because 400 would tell the caller their request was wrong when it was
    // not — and would send them off editing a body that is fine. Nothing was
    // kept, and the same call would fail the same way, so this is the 500 the
    // guide describes: report it and stop.
    const status = result.bug ? 500 : result.error.startsWith("an entry already exists") ? 409 : 400;
    return Response.json({ error: result.error }, { status });
  }

  const written = { slug: result.slug, status: result.status };
  remember(key, fingerprint, written);

  return Response.json(
    {
      ok: true,
      ...written,
      note: "Created as a draft. Read it back to them, then POST .../days/<slug>/publish when they say so.",
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
