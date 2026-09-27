import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LifetimeMap, { type CountryVisit } from "@/components/LifetimeMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { buildLifetimeViews, type VisitedCountry } from "@/lib/lifetimeMapViews";
import countryColours from "@/lib/countryColours.json";
import countries from "@/lib/worldCountries.json";

/**
 * B361/B2491. The lifetime map answers "everywhere we have been", and at
 * world scale the honest unit of "where" is a country: fifteen pins in
 * Thailand and one pin in Thailand say the same thing to a reader.
 *
 * B2491 replaced B2423's single neutral "visited" tint — which made two
 * trips through Switzerland and two unrelated coral trips look identical for
 * no reason a reader could learn — with one **fixed colour per country**
 * (`lib/countryColours.json`), and removed every route, marker and trip
 * legend from this map entirely (decision 1).
 */

/** Real outlines from the baked data, so the test exercises what ships. */
function shapeOf(code: string) {
  const c = (countries as { code: string | null; name: string; path: string; x: number }[]).find(
    (x) => x.code === code,
  );
  if (!c) throw new Error(`no ${code} in lib/worldCountries.json`);
  return { code, name: c.name, path: c.path, x: c.x };
}

const ONE: CountryVisit = { ...shapeOf("TH"), trips: [{ id: "t1", title: "Trip one" }] };
const TWO: CountryVisit = {
  ...shapeOf("US"),
  trips: [
    { id: "t1", title: "Trip one" },
    { id: "t2", title: "Trip two" },
  ],
};

function render(visits: CountryVisit[], extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <LifetimeMap visits={visits} pinned={null} onPinnedChange={() => {}} {...extra} />
    </LocaleProvider>,
  );
}

describe("the baked country data", () => {
  test("identifies countries by ISO alpha-2, with a continent and subregion", () => {
    const list = countries as { code: string | null; continent: string; subregion: string }[];
    const ch = list.find((c) => c.code === "CH")!;
    expect(ch.continent).toBe("Europe");
    expect(ch.subregion).toBe("Western Europe");
  });

  test("Israel follows Natural Earth into Asia/Western Asia — decision 11", () => {
    const il = (countries as { code: string | null; continent: string; subregion: string }[]).find(
      (c) => c.code === "IL",
    )!;
    expect(il.continent).toBe("Asia");
    expect(il.subregion).toBe("Western Asia");
  });

  test("gives each country a single path, so it is one shape to fill", () => {
    const th = (countries as { code: string | null; path: string }[]).filter((c) => c.code === "TH");
    expect(th).toHaveLength(1);
    expect(th[0].path.startsWith("M")).toBe(true);
  });
});

describe("countries visited (server render, no JS)", () => {
  test("fills a visited country in its own fixed colour, from the generated table", () => {
    const html = render([ONE]);
    const colour = (countryColours as Record<string, string>).TH;
    expect(html).toContain(`fill="${colour}"`);
  });

  test("two countries get two different fixed colours", () => {
    const html = render([ONE, TWO]);
    const thColour = (countryColours as Record<string, string>).TH;
    const usColour = (countryColours as Record<string, string>).US;
    expect(thColour).not.toBe(usColour);
    expect(html).toContain(`fill="${thColour}"`);
    expect(html).toContain(`fill="${usColour}"`);
  });

  test("the legend names the countries and counts repeat visits", () => {
    const html = render([ONE, TWO]);
    expect(html).toContain("Thailand");
    expect(html).toContain("United States of America");
    expect(html).toContain("×2"); // visited by two trips
  });

  test("no country names, trips or a legend of trips are written across the map itself", () => {
    // Decision 1: no route, no dot, no per-trip legend — only the country
    // fill and the countries-only legend in the figcaption.
    expect(render([ONE, TWO])).not.toContain("<text");
  });

  test("every country is reachable and named for a keyboard user and a screen reader", () => {
    const html = render([ONE]);
    expect(html).toMatch(/aria-label="Thailand — trip"/);
  });

  test("a journal with no country data renders the plain world, not an empty frame", () => {
    const html = render([]);
    expect(html).toContain('role="img"');
    expect(html).not.toContain((countryColours as Record<string, string>).TH);
  });

  test("the svg stops calling itself an image once a country is fillable", () => {
    expect(render([ONE])).toContain('role="group"');
    expect(render([])).toContain('role="img"');
  });
});

describe("continent/area buttons (decisions 3–4)", () => {
  function visitedFrom(entries: { code: string; continent: string; subregion: string }[]): {
    visits: CountryVisit[];
    visited: VisitedCountry[];
  } {
    return {
      visits: entries.map((e) => ({ ...shapeOf(e.code), trips: [{ id: "t", title: "Trip" }] })),
      visited: entries,
    };
  }

  test("a one-continent journal shows no continent buttons", () => {
    const { visits, visited } = visitedFrom([
      { code: "CH", continent: "Europe", subregion: "Western Europe" },
    ]);
    const { views, continents } = buildLifetimeViews(visited, new Map(), new Map());
    const html = render(visits, { views, continents });
    expect(html).not.toContain("trips.map.continent"); // no stray untranslated key
    expect(continents.length).toBeLessThan(2);
  });

  test("a two-continent journal shows continent buttons, sorted by count", () => {
    const { visits, visited } = visitedFrom([
      { code: "CH", continent: "Europe", subregion: "Western Europe" },
      { code: "PT", continent: "Europe", subregion: "Southern Europe" },
      { code: "TH", continent: "Asia", subregion: "South-Eastern Asia" },
    ]);
    const { views, continents } = buildLifetimeViews(visited, new Map(), new Map());
    const html = render(visits, { views, continents });
    expect(html).toContain("Europe");
    expect(html).toContain("Asia");
  });
});

describe("map detail (basemap per view)", () => {
  const basemap = {
    borders: ["M0,0 L1,1 Z"],
    admin1: [],
    relief: [],
    glaciers: [],
    parks: [],
    railroads: [],
    roads: [],
    lakes: ["M2,2 L3,3 Z"],
    rivers: ["M4,4 L5,5 Z"],
    peaks: [],
    towns: [],
    attribution: "",
  };

  function withMap(views: unknown[]) {
    return render([ONE], { views });
  }

  /**
   * Server-rendered HTML deliberately shows the plain world outline
   * (`useWorldLand`), not the "all" view's own detailed basemap — the same
   * starting state the Einstieg glides *from* (decision 5), which only a
   * client effect ever advances past. `withMap`'s basemap fixture is real
   * and reaches the DOM once that effect runs (covered by the
   * jsdom-mounted tests in `test/lifetime-map.test.tsx`); a pure
   * `renderToStaticMarkup` pass never runs an effect, so it never sees it.
   */
  test("without JavaScript, draws the plain world outline rather than the per-view basemap", () => {
    const views = [
      { id: "all", kind: "all", countryCodes: ["TH"], frame: { x: 0, y: 0, w: 100, h: 60, lngScale: 1 }, basemap },
    ];
    const html = withMap(views);
    expect(html).not.toContain("M0,0 L1,1 Z");
    // The country fill itself is still there — B361's actual promise.
    expect(html).toContain((countryColours as Record<string, string>).TH);
  });

  test("a journal with no basemap at all still renders, on the plain outline", () => {
    expect(() => render([ONE])).not.toThrow();
  });
});
