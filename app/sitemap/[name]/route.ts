import { sitemapFor, urlsetXml, xmlResponse } from "@/lib/sitemap";

/** One child of the sitemap index: /sitemap/pages.xml, journals.xml, agents.xml — B2486. */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/sitemap/[name]">): Promise<Response> {
  const { name } = await params;
  const entries = name.endsWith(".xml") ? sitemapFor(name.slice(0, -4)) : null;
  if (!entries) return new Response("Not found", { status: 404 });
  return xmlResponse(urlsetXml(entries));
}
