import type { MetadataRoute } from "next";
import { serverSite } from "@/lib/site";

/**
 * robots.txt — B2486, as the owner decided it on 2026-09-27.
 *
 * Everything is open except Next's internals and the areas that belong to one
 * signed-in person. `/api/` stays crawlable on purpose: agents read the
 * OpenAPI spec there. No AI-training crawler is blocked — the owner chose to
 * allow them. No `Host:` line: it was Yandex-only and says nothing to anyone
 * else. `test/robots.test.ts` pins every line.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/_next/", "/admin", "/*/studio", "/*/me", "/*/account", "/*/payment", "/w/", "/j/", "/t/"],
      },
    ],
    sitemap: `${serverSite().url}/sitemap.xml`,
  };
}
