import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BlogStructuredData, DayStructuredData } from "@/components/StructuredData";
import type { SiteSummary } from "@/lib/site";
import type { Entry } from "@/lib/types";

/**
 * Item 6 of the W37 followups: `authors` used to be a single string joined
 * with " & ", so two travellers on a trip became one `Person` with an
 * ampersand in its name. It is now `string[]`, one name per traveller — this
 * asserts the JSON-LD shape actually reflects that, rather than trusting a
 * reading of the code.
 */

const site: SiteSummary = {
  username: "alex",
  title: "Alex & Robin's journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  travellerFigures: [],
  signedIn: false,
  name: "Fernscout",
  hasIdentity: false,
  canSignIn: false,
  analyticsEnabled: true,
  helperEnabled: false,
  isOwner: false,
  extractEnabled: false,
  isShowcase: false,
};

const authors = ["Alex Berger", "Robin Berger"];

function jsonLdFrom(html: string): Record<string, unknown> {
  const match = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("no <script> tag in the rendered markup");
  return JSON.parse(match[1].replace(/\\u003c/g, "<")) as Record<string, unknown>;
}

describe("StructuredData's author list", () => {
  test("BlogStructuredData emits one Person per traveller, not one joined name", () => {
    const html = renderToStaticMarkup(<BlogStructuredData entries={[]} site={site} authors={authors} dayBase="/alex" inLanguage="en" />);
    const data = jsonLdFrom(html);

    expect(data.author).toEqual([
      { "@type": "Person", name: "Alex Berger" },
      { "@type": "Person", name: "Robin Berger" },
    ]);
    expect(JSON.stringify(data.author)).not.toContain("&");
  });

  test("DayStructuredData emits one Person per traveller, not one joined name", () => {
    const entry: Entry = {
      slug: "2026-08-31-arrival",
      title: "Arrival",
      date: "2026-08-31",
      location: "Zurich",
      country: "Switzerland",
      lat: 47.3769,
      lng: 8.5417,
      gallery: [],
      tags: [],
      costs: [],
      content: "We landed.",
    };

    const html = renderToStaticMarkup(<DayStructuredData entry={entry} site={site} authors={authors} url="/alex/day/2026-08-31-arrival" trip={{ title: "T", path: "/alex" }} inLanguage="en" />);
    const data = jsonLdFrom(html);

    expect(data.author).toEqual([
      { "@type": "Person", name: "Alex Berger" },
      { "@type": "Person", name: "Robin Berger" },
    ]);
    expect(JSON.stringify(data.author)).not.toContain("&");
  });
});

/**
 * B2476 — the day URLs in here were `<journal>/day/<slug>` whatever trip the
 * day belonged to, which is a 404 for every trip but the current one.
 */
describe("StructuredData's URLs are the page's own", () => {
  const entry: Entry = {
    slug: "over-the-pass",
    title: "Over the pass",
    date: "2024-07-02",
    location: "Pass",
    country: "Switzerland",
    lat: 46.7,
    lng: 8.4,
    gallery: [],
    tags: [],
    costs: [],
    content: "Up and over.",
  };

  test("a past trip's posts live under its own /trips/<id>", () => {
    const html = renderToStaticMarkup(
      <BlogStructuredData entries={[entry]} site={site} authors={authors} dayBase="/alex/trips/alps" inLanguage="de" />,
    );
    const data = jsonLdFrom(html);
    expect(data.url).toBe("https://example.test/alex");
    expect(data.inLanguage).toBe("de");
    expect(data.blogPost).toEqual([
      expect.objectContaining({ url: "https://example.test/alex/trips/alps/day/over-the-pass" }),
    ]);
  });

  test("a day's url is its canonical, with a breadcrumb journal > trip > day", () => {
    const html = renderToStaticMarkup(
      <DayStructuredData
        entry={entry}
        site={site}
        authors={authors}
        url="/alex/trips/alps/day/over-the-pass"
        trip={{ title: "Alps", path: "/alex/trips/alps" }}
        inLanguage="en"
      />,
    );
    const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) => JSON.parse(m[1].replace(/\\u003c/g, "<")) as Record<string, unknown>,
    );
    const post = blocks.find((b) => b["@type"] === "BlogPosting");
    const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList");
    expect(post?.url).toBe("https://example.test/alex/trips/alps/day/over-the-pass");
    expect(crumbs?.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: site.title, item: "https://example.test/alex" },
      { "@type": "ListItem", position: 2, name: "Alps", item: "https://example.test/alex/trips/alps" },
      { "@type": "ListItem", position: 3, name: "Over the pass", item: "https://example.test/alex/trips/alps/day/over-the-pass" },
    ]);
  });
});
