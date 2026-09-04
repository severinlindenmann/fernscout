import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { isTestContent } from "@/lib/access";
import { EDITABLE_DAY_FIELDS, editEntry, type EditInput } from "@/lib/api/entries";
import { getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import { validateEntryEdit } from "@/lib/validate/entry";

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


/**
 * One day, in full — including a draft.
 *
 * The gap this fills: an agent could write a day and never read it back.
 * `/drafts` lists slugs, titles and dates; the markdown twin at
 * `/<user>/day/<slug>.md` is gated like the public page and so answers 404 for
 * anything unpublished. So an agent that wanted to check its own work before
 * telling a person it was ready — which is exactly what we ask it to do — had
 * nowhere to look, and neither did the owner's own tooling. Both the companion
 * and the owner asked for this in testing.
 *
 * Authenticated and scoped like every other write on this path, because a
 * draft is the most private thing in the journal: it is what somebody has not
 * decided to publish. `mayWriteTrip` rather than a read check — whoever may
 * change the day may read it.
 *
 * A trip that does not exist and a trip that is not yours answer the same way,
 * so a token scoped to one trip cannot enumerate the journal's others.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days/[slug]">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip, slug } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  const entry = getEntryBySlug(ref, slug, { includeDrafts: true });
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });

  return Response.json({
    trip: ref,
    slug: entry.slug,
    title: entry.title,
    date: entry.date,
    ...(entry.time ? { time: entry.time } : {}),
    location: entry.location,
    country: entry.country,
    ...(Number.isFinite(entry.lat) ? { lat: entry.lat } : {}),
    ...(Number.isFinite(entry.lng) ? { lng: entry.lng } : {}),
    gallery: entry.gallery,
    tags: entry.tags,
    costs: entry.costs,
    // Both accepted on the way in, and until W38 neither came back — so an
    // agent doing what the guide asks, reading its own work back before
    // telling somebody it is ready, could confirm the prose and the costs and
    // not the rest. A field the API takes is a field it has to show.
    ...(entry.transport ? { transport: entry.transport } : {}),
    /**
     * The flag the *page* will act on, not just the entry's own.
     *
     * A day in a test trip carries no flag of its own and still gets the
     * banner, so reporting only `entry.test` told an agent that had marked the
     * whole trip that its day was ordinary. `isTestContent` is the predicate
     * the renderer uses; this is the same question.
     */
    ...(isTestContent(found, entry) ? { test: true } : {}),
    content: entry.content,
    // Stated rather than implied. An agent reporting back to a person needs to
    // say whether this is on the site, and `status` absent from a response is
    // too easy to read as "published".
    status: entry.draft ? "draft" : "published",
  });
}

/**
 * Edit a day that already exists — B266.
 *
 * Before this there was no way to change a day once written, and the agent
 * that tried reached for `.../publish` instead, because it was the only verb
 * that touched an existing file — and published fifteen unreviewed days while
 * reporting them as drafts. See `lib/api/entries.ts`'s `editEntry` for how
 * this is made structurally incapable of repeating that: `status` is not a
 * field this writes, by type and by an explicit refusal below, and a draft
 * stays a draft and a published day stays published whatever the body asks
 * for — checked again after the edit, not merely assumed from the code.
 *
 * Same authority as writing a day in the first place: whoever `mayWriteTrip`
 * lets create a day may correct one, trip-scoped tokens included. Publishing
 * and unpublishing stay owner-only, through their own endpoint — this one
 * cannot reach either.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days/[slug]">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip, slug } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return Response.json(
      {
        error: "invalid_request",
        message: `Name what to change: one or more of ${EDITABLE_DAY_FIELDS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  /**
   * Named rather than dropped — the same shape as `owner.email` on the
   * journal config PATCH. `status` is the one this ticket is about: a day
   * moves between draft and published only through `.../publish`, never by
   * this call, whatever it is asked to set — so a body that names it is
   * refused whole rather than partially applied, and the caller is told why
   * instead of quietly being ignored.
   */
  const unwritable = keys.filter((key) => !(EDITABLE_DAY_FIELDS as readonly string[]).includes(key));
  if (unwritable.length > 0) {
    return Response.json(
      {
        error: "unsupported_field",
        message:
          `This call changes ${unwritable.map((k) => JSON.stringify(k)).join(", ")} for nobody, ` +
          "and nothing was written. A day moves between draft and published only through " +
          "POST .../publish — never through this call, whatever it is asked to set. This " +
          `endpoint writes ${EDITABLE_DAY_FIELDS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const problems = validateEntryEdit(body, languagesOf(user));
  if (problems.length > 0) {
    return Response.json({ error: "invalid_entry", problems }, { status: 400 });
  }

  const result = editEntry(ref, slug, body as EditInput);
  if (!result.ok) {
    const status = result.bug ? 500 : result.error === "unknown_day" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }

  // The half B263 and this ticket both turn on: what the agent reports back
  // has to be the day's actual state, not its own intention. So this says it
  // plainly rather than leaving it to be inferred from a 200.
  return Response.json({
    ok: true,
    slug: result.slug,
    status: result.status,
    changed: keys,
    note:
      result.status === "draft"
        ? `Still a draft — not on the site. This call cannot publish it; ` +
          `POST .../days/${result.slug}/publish when they say so.`
        : "Still published — anyone who already read it can now see this change. " +
          "This call cannot take it off the site or move it back to draft.",
  });
}
