import { editEntry, journalLanguages, type EditInput } from "@/lib/api/entries";
import { isOwner } from "@/lib/contacts/session";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import { validateEntryEdit } from "@/lib/validate/entry";

export const dynamic = "force-dynamic";

/**
 * The owner correcting their own day, from the day — B980.
 *
 * `PATCH /api/v1/<user>/trips/<trip>/days/<slug>` has done this since B266,
 * and a browser cannot call it: `/api/v1` reads `Authorization: Bearer` and
 * nothing else, on purpose (decision 24 — reading the site on your phone must
 * not put a credential that can rewrite it in your pocket). So the owner
 * standing on the day they want to fix had one route into it, and it went
 * through another page and a model: "the time was 14:00, not 15:00" cost a
 * conversation.
 *
 * This is the same door `notify` beside it is, for the same reason and with
 * the same three properties:
 *
 * - **Not under `/api/v1/`.** An agent already has the PATCH. This is not a
 *   second way to reach it; it is the one the person whose journal it is
 *   presses themselves.
 * - **The owner's cookie only.** `isOwner` without the request, and a request
 *   carrying `Authorization` is refused outright rather than falling through
 *   to a weaker check.
 * - **The same validator and the same writer.** `validateEntryEdit` and
 *   `editEntry`, so a correction made in a browser lands exactly as one made
 *   by an agent, refusals included. Nothing about days is re-implemented here.
 *
 * **It cannot publish and it cannot unpublish**, which is not an oversight:
 * a day moves on and off the site through its own endpoint, and the PATCH
 * this delegates to has refused `status` since B266 for the reason B28 gives.
 * `EDITABLE` narrows even that list to what the panel actually draws — a
 * field nobody can type is a field this route has no business accepting.
 */
const EDITABLE = [
  "title",
  "time",
  "content",
  "location",
  "date",
  "visibility",
  "translations",
  // Round 2's two, and they were missing for four days — B1586. The rule the
  // comment above states is the right one; this list simply stopped following
  // the panel when the panel grew a caption box and a per-photograph select.
  // Getting it wrong was expensive rather than merely incomplete: the panel
  // sends one patch per update, and an unknown key refuses the whole of it, so
  // a title corrected in the same press was lost too.
  "captions",
  "photoVisibility",
];

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent corrects a day with " +
    "PATCH /api/v1/<user>/trips/<trip>/days/<slug>.",
};

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/[user]/trips/[trip]/day/[slug]/edit">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip, slug } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  if (!getTrip(ref))
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  if (!getEntryBySlug(ref, slug, AS_AUTHOR)) {
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const keys = Object.keys(body);
  if (keys.length === 0)
    return Response.json({ error: "nothing_to_change" }, { status: 400 });
  if (keys.some((key) => !EDITABLE.includes(key))) {
    return Response.json({ error: "unsupported_field" }, { status: 400 });
  }

  // The one fact the validator cannot know on its own — the day's gallery as
  // it stands — so a `src` naming no photograph on it is refused rather than
  // silently matching nothing. The same argument the API route passes, B540.
  const current = getEntryBySlug(ref, slug, AS_AUTHOR);
  const problems = validateEntryEdit(
    body,
    journalLanguages(user),
    current?.gallery.map((item) => item.src),
  );
  if (problems.length > 0) {
    return Response.json({ error: "invalid_entry", problems }, { status: 400 });
  }

  const result = editEntry(ref, slug, body as EditInput);
  if (!result.ok) {
    const status = result.bug
      ? 500
      : result.error === "unknown_day"
        ? 404
        : 400;
    return Response.json({ error: result.error }, { status });
  }

  // The slug travels: a day whose date moved is a day whose file moved, and
  // the panel has to know where the day it just wrote now lives.
  return Response.json({ ok: true, slug: result.slug, status: result.status });
}
