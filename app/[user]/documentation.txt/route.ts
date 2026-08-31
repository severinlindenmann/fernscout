import { userDocumentation } from "@/lib/api/documentation";
import { getUsernames } from "@/lib/users";

/** One journal's document. Per llmstxt.org, a file covers the URLs beneath it
 * and agents take the most specific one — which is exactly per user here. */
export function generateStaticParams() {
  return getUsernames().map((user) => ({ user }));
}

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
