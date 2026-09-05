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
  hasIdentity: false,
  canSignIn: false,
  costsEnabled: true,
};

const authors = ["Alex Berger", "Robin Berger"];

function jsonLdFrom(html: string): Record<string, unknown> {
  const match = html.match(/<script[^>]*>([\s\S]*)<\/script>/);
  if (!match) throw new Error("no <script> tag in the rendered markup");
  return JSON.parse(match[1].replace(/\\u003c/g, "<")) as Record<string, unknown>;
}

describe("StructuredData's author list", () => {
  test("BlogStructuredData emits one Person per traveller, not one joined name", () => {
    const html = renderToStaticMarkup(<BlogStructuredData entries={[]} site={site} authors={authors} />);
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

    const html = renderToStaticMarkup(<DayStructuredData entry={entry} site={site} authors={authors} />);
    const data = jsonLdFrom(html);

    expect(data.author).toEqual([
      { "@type": "Person", name: "Alex Berger" },
      { "@type": "Person", name: "Robin Berger" },
    ]);
    expect(JSON.stringify(data.author)).not.toContain("&");
  });
});
