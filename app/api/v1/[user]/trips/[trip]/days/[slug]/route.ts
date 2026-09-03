import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { isTestContent } from "@/lib/access";
import { getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

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
