import { contentModel } from "@/lib/contentModel/document";

/**
 * The file shape a Fernscout journal must have — the third published
 * contract beside `/openapi.json` (what the API takes) and `/api/health`
 * (what this server offers). See
 * `docs/plans/W41-the-file-shape-is-published.md`.
 *
 * Public and unauthenticated, and cached the same way `/openapi.json` is:
 * short enough that a change to this document reaches a client within
 * minutes, long enough that a client checking it on every run costs it
 * nothing. No `X-Robots-Tag` — see the comment on `/openapi.json`'s route for
 * why (B256): this document's whole audience is automated fetchers, and
 * `noindex` reads to one of those as "do not use this content".
 */
export function GET() {
  return Response.json(contentModel(), {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
