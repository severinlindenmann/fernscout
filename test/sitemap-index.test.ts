import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SITEMAPS,
  agentsSitemap,
  journalsSitemap,
  pagesSitemap,
  sitemapIndexXml,
  urlsetXml,
} from "@/lib/sitemap";
import { serverSite } from "@/lib/site";

/**
 * B2486 — /sitemap.xml is an index of three children, every entry is a page
 * that answers, and every date is the content's own.
 */
const base = serverSite().url;

describe("the sitemap index", () => {
  test("names each child at /sitemap/<name>.xml", () => {
    const xml = sitemapIndexXml();
    expect(xml).toContain("<sitemapindex");
    for (const name of SITEMAPS) expect(xml).toContain(`<loc>${base}/sitemap/${name}.xml</loc>`);
  });

  test("a child is a urlset with lastmod, hreflang and image entries when given", () => {
    const xml = urlsetXml([
      { url: `${base}/a`, lastmod: "2024-07-02", alternates: { de: `${base}/de/a` }, images: [`${base}/x.jpg`] },
    ]);
    expect(xml).toContain("<urlset");
    expect(xml).toContain(`<loc>${base}/a</loc><lastmod>2024-07-02</lastmod>`);
    expect(xml).toContain(`hreflang="de" href="${base}/de/a"`);
    expect(xml).toContain(`<image:loc>${base}/x.jpg</image:loc>`);
  });
});

describe("what the children list", () => {
  const journals = journalsSitemap();

  test("the example journal's days are there, dated by the day", () => {
    const day = journals.find((e) => /\/example\/.*day\//.test(e.url));
    expect(day?.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("every journal entry carries a content date, and none is a ?lang= duplicate", () => {
    for (const e of journals) {
      expect(e.url).not.toContain("?lang=");
      expect(e.lastmod, e.url).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("a day with photographs lists them as images on its own server", () => {
    const withImages = journals.find((e) => (e.images?.length ?? 0) > 0);
    expect(withImages).toBeDefined();
    for (const src of withImages!.images!) expect(src.startsWith(`${base}/`)).toBe(true);
  });

  test("the instance's pages carry no invented date, and /docs/hosting is among them", () => {
    const pages = pagesSitemap();
    expect(pages.map((p) => p.url)).toContain(`${base}/docs/hosting`);
    expect(pages.every((p) => p.lastmod === undefined)).toBe(true);
  });

  test("the agents sitemap leaves out the noindex /documentation.txt", () => {
    const urls = agentsSitemap().map((e) => e.url);
    expect(urls).not.toContain(`${base}/documentation.txt`);
    expect(urls).toContain(`${base}/llms.txt`);
  });

  test("every agent document listed has a route behind it", () => {
    for (const { url } of agentsSitemap()) {
      const route = url.slice(base.length);
      const file =
        route === "/api/v2/openapi.json"
          ? "app/api/v2/openapi.json/route.ts"
          : `app${route}/route.ts`;
      expect(fs.existsSync(path.join(process.cwd(), file)), file).toBe(true);
    }
  });
});
