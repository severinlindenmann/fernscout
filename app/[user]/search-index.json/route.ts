import { resolveAccess } from "@/lib/auth/handshake";
import { buildSearchIndexJson, buildSearchIndexJsonForReader } from "@/lib/search";

/**
 * Rendered per request, not at build time.
 *
 * It used to be prerendered, and that made a privacy setting that did not take
 * effect: set `visibility: private` on a trip and the page locked at once — so
 * the owner reasonably believed it was done — while this file went on
 * publishing every one of that trip's days, in full, until somebody rebuilt.
 * The same staleness kept a newly published day *out* of the feed, which is
 * the harmless direction of one bug.
 *
 * Cheap enough to do per request: one pass over entries that are already
 * parsed and cached in memory, behind a short cache header.
 *
 * B635: a signed-out reader (or one signed in with no more than a stranger's
 * rights) still gets the same public, cacheable index as before —
 * `buildSearchIndexJson`, the `isIndexable` discipline the sitemap and the
 * feed also use. An address on the request gets a **reader-scoped** index
 * instead — the owner's own trips, and any trip they are a person on,
 * whatever it is closed to — built by `buildSearchIndexJsonForReader`, which
 * asks `readFor`/`isOwner`/`isTravellerOn` exactly the way every other
 * reading path does. That answer is good for this one reader only, so it
 * is served `Cache-Control: private` — the same header story.json uses for
 * the same reason: a shared or CDN cache must never hand one reader's search
 * index to the next.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/[user]/search-index.json">,
) {
  const { user } = await params;
  const { email } = await resolveAccess(user);
  const json = email
    ? await buildSearchIndexJsonForReader(user, request)
    : buildSearchIndexJson(user);
  if (!json) return new Response("Not found", { status: 404 });

  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": email
        ? "private, max-age=60, stale-while-revalidate=600"
        : "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
