import { markdownTwin } from "@/lib/api/markdownTwin";

/**
 * A day's markdown source.
 *
 * Two URLs reach here through rewrites in next.config.ts, because a day page
 * has two URLs and the promise is that `.md` on the end of *either* gives you
 * its source:
 *
 *   /<user>/day/<slug>.md                 -> [<slug>]
 *   /<user>/trips/<trip>/day/<slug>.md    -> [<trip>, <slug>]
 *
 * A catch-all rather than two route folders: `[slug]` and `[trip]/[slug]`
 * cannot both sit under `[user]`, since Next refuses two different names for
 * the same dynamic position.
 *
 * The convention is llmstxt.org's — a clean markdown twin of each page — and
 * here it is nearly free, because the content already *is* markdown. Nothing
 * is converted, so nothing can drift between what a reader sees and what an
 * agent reads. All the gating and the plain-text 404 are in
 * `lib/api/markdownTwin.ts`.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/md/[user]/[...path]">) {
  const { user, path } = await params;

  if (path.length === 1) return markdownTwin(user, null, path[0]);
  if (path.length === 2) return markdownTwin(user, path[0], path[1]);

  return new Response(
    "A markdown twin is /<user>/day/<slug>.md or /<user>/trips/<trip>/day/<slug>.md\n",
    { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
