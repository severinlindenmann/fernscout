import type { MetadataRoute } from "next";
import { serverSite } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Nothing to hide, but keep Next's internals out of the index.
        disallow: ["/_next/"],
      },
    ],
    sitemap: `${serverSite().url}/sitemap.xml`,
    host: serverSite().url,
  };
}
