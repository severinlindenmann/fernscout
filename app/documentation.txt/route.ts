import { instanceDocumentation } from "@/lib/api/documentation";

/**
 * The document an owner hands to their agent (decision 25).
 *
 * `noindex` because it belongs in an agent's context, not in search results —
 * and that header, not the filename, is what actually keeps it out. Naming it
 * `documentation.txt` rather than `llms.txt` only avoids being harvested by
 * bots that probe the convention on every domain; it is not a secret, and it
 * documents an API whose write path needs a token anyway.
 */
export function GET() {
  return new Response(instanceDocumentation(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=300",
    },
  });
}
