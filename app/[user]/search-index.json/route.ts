import { buildSearchIndexJson } from "@/lib/search";

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
 */
export const dynamic = "force-dynamic";


export async function GET(
  _request: Request,
  { params }: RouteContext<"/[user]/search-index.json">,
) {
  const { user } = await params;
  const json = buildSearchIndexJson(user);
  if (!json) return new Response("Not found", { status: 404 });

  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
