import { unpublishEntry } from "@/lib/api/entries";
import { isOwner } from "@/lib/contacts/session";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * Taking a day off the site, from the day itself — B980 round 3.
 *
 * `POST /api/v1/<user>/trips/<trip>/days/<slug>/unpublish` has done this
 * since B905, and a browser cannot call it for the same reason `edit/route.ts`
 * beside this file cannot PATCH `/api/v1` directly: that door reads
 * `Authorization: Bearer` and nothing else (decision 24). This is the same
 * shape as `edit/route.ts`'s three properties, for the other half of the
 * tile's promise:
 *
 * - **Not under `/api/v1/`.** An agent already has the POST above.
 * - **The owner's cookie only.** `isOwner` without the request, and a bearer
 *   token is refused outright rather than falling through to a weaker check —
 *   which is also why a trip-scoped agent token gets nowhere near this door:
 *   any `Authorization` header at all is refused before it is even read.
 * - **The same writer.** `unpublishEntry`, so a takedown pressed here and one
 *   an agent makes land identically — draft again, on disk, everything still
 *   attached.
 *
 * "Correct or take down" on the tile has promised this since B816; B1013
 * recorded that the panel it now opens could not do the second half yet, and
 * relabelled the tile rather than leave the promise standing on nothing. This
 * route, and the button in `EditDay` that calls it, is what makes it true
 * again.
 */
const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent takes a day off the site with " +
    "POST /api/v1/<user>/trips/<trip>/days/<slug>/unpublish.",
};

export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/trips/[trip]/day/[slug]/unpublish">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip, slug } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  if (!getTrip(ref)) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) {
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }
  // Not an error worth a 500, and not silently fine either — the same
  // reasoning `.../publish` and the API's own `.../unpublish` both give for
  // repeating a decision that has already happened.
  if (entry.draft) {
    return Response.json({ error: "already_draft" }, { status: 409 });
  }

  const result = unpublishEntry(ref, slug);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ ok: true, slug: result.slug, status: "draft" });
}
