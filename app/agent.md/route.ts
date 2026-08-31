import { agentGuide } from "@/lib/api/documentation";

/** The full guide. Generated beside the routes it describes, so an endpoint
 * change and a stale document are the same diff rather than two. */
export function GET() {
  return new Response(agentGuide(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=300",
    },
  });
}
