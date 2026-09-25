import { userDocumentation } from "@/lib/api/documentation";

/**
 * One journal's document. Per llmstxt.org, a file covers the URLs beneath it
 * and agents take the most specific one — which is exactly per user here.
 *
 * **Rendered per request, not prerendered.** It used to carry a
 * `generateStaticParams` over `getUsernames()`, and a Route Handler with one
 * is *fully* static: the params that existed at build time are the only ones
 * that exist at all, and every other journal answers 404. Pages get away with
 * this because `dynamicParams` renders them on demand; handlers do not. So a
 * journal created after the last build — which is every journal made through
 * `POST /api/v1/journals` — advertised a document that did not resolve, and
 * the instance's own index linked to it.
 *
 * The content is a live count of trips and days besides, so a build-time
 * snapshot of it was already stale by the first entry written.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/[user]/documentation.txt">,
) {
  const { user } = await params;
  const body = userDocumentation(user);
  if (!body) return new Response("Not found", { status: 404 });

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=300",
    },
  });
}
