import { sitemapIndexXml, xmlResponse } from "@/lib/sitemap";

/**
 * The sitemap index — B2486. Per request, for the same reason as feed.xml:
 * a prerendered list keeps naming a trip somebody has just made private.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return xmlResponse(sitemapIndexXml());
}
