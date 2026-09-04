import { openApiDocument } from "@/lib/api/openapi";

/**
 * The machine contract for the same API `/agent.md` describes in prose, and
 * the same document `/docs/api` renders for a person — see the comment on
 * `openApiDocument` for why it lives there rather than here.
 *
 * **No `X-Robots-Tag` here, unlike `/documentation.txt` and `/openapi.json`'s
 * sibling below it once carried too — B256.** A well-behaved automated
 * fetcher can read `noindex` as "do not use this content", which is exactly
 * the wrong instruction on a document whose entire audience is automated
 * fetchers: an agent that obeyed it, or that treated the header as a reason
 * not to trust the fetch, was left with nothing but this file's own 3.7 KB
 * summary and no way to finish signing somebody up. `/documentation.txt`
 * keeps the header — it is the index, meant to stay out of search results,
 * and it demonstrably still fetches fine with it on.
 */
export function GET() {
  return Response.json(openApiDocument(), {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
