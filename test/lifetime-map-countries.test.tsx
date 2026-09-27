import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LifetimeMap, { type CountryVisit, type TripRoute } from "@/components/LifetimeMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import countries from "@/lib/worldCountries.json";

/**
 * B361. The lifetime map answers "everywhere we have been", and at world scale
 * the honest unit of "where" is a country: fifteen pins in Thailand and one pin
 * in Thailand say the same thing to a reader, and drawing fifteen is what made
 * it an unreadable smear.
 *
 * B2423 replaced the per-country flag colour (`lib/flagColours.ts`, B370,
 * B375 — both retired with it) with one neutral "visited" tint, since two
 * trips through Switzerland and two unrelated coral trips clashed for no
 * reason a reader could learn. `CountryVisit` no longer carries a `colour`.
 */

const route: TripRoute = {
  id: "t1",
  title: "Trip one",
  accent: "sky",
  points: [
    { lat: 13.7, lng: 100.5, location: "" },
    { lat: 40.7, lng: -74.0, location: "" },
  ],
};

function render(visits: CountryVisit[]) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <LifetimeMap routes={[route]} visits={visits} userPath="/u" />
    </LocaleProvider>,
  );
}

/** Real outlines from the baked data, so the test exercises what ships. */
function shapeOf(code: string) {
  const c = (countries as { code: string | null; name: string; path: string }[]).find(
    (x) => x.code === code,
  );
  if (!c) throw new Error(`no ${code} in lib/worldCountries.json`);
  return { code, name: c.name, path: c.path };
}

const ONE: CountryVisit = { ...shapeOf("TH"), trips: [{ id: "t1", title: "Trip one" }] };
const TWO: CountryVisit = {
  ...shapeOf("US"),
  trips: [
    { id: "t1", title: "Trip one" },
    { id: "t2", title: "Trip two" },
  ],
};

describe("the baked country data", () => {
  test("identifies countries by ISO alpha-2", () => {
    const codes = (countries as { code: string | null }[]).map((c) => c.code);
    expect(codes).toContain("TH");
    expect(codes).toContain("US");
    expect(codes).toContain("CH");
  });

  test("gives each country a single path, so it is one shape to fill", () => {
    const th = (countries as { code: string | null; path: string }[]).filter(
      (c) => c.code === "TH",
    );
    expect(th).toHaveLength(1);
    expect(th[0].path.startsWith("M")).toBe(true);
  });
});

describe("countries visited", () => {
  test("a country one trip reached links to that trip", () => {
    expect(render([ONE])).toContain('href="/u/trips/t1"');
  });

  /**
   * The owner's own question, and the demo already contains it — the United
   * States is on both `usa-2026` and `parks-2025`. Several trips have no single
   * destination, and quietly sending the reader to the most recent is the trap
   * the fill-colour decision already turned down.
   */
  test("a country several trips reached names them all and links to none", () => {
    const html = render([TWO]);
    expect(html).toContain("Trip one, Trip two");
    expect(html).not.toContain('href="/u/trips/t2"');
  });

  /**
   * B2423. Every visited country is the same fill — `--map-visited`, read
   * through `lib/map/style.ts`'s `mapStyle.visited` — whether one trip
   * reached it or five. Replaces the old "filled in its flag's colour" test,
   * whose whole premise (a colour per country) B2423 removed.
   */
  test("one visited tint regardless of trip count", () => {
    const html = render([ONE, TWO]);
    const fills = [...html.matchAll(/fill="(var\(--map-visited\))"/g)].map((m) => m[1]);
    expect(fills).toHaveLength(2);
    expect(new Set(fills).size).toBe(1);
  });

  test("the legend names the countries and counts repeat visits", () => {
    const html = render([ONE, TWO]);
    expect(html).toContain("Thailand");
    expect(html).toContain("United States of America");
    expect(html).toContain("×2"); // visited by two trips
  });

  /**
   * B2423/B361. A country's hover text used to be a native SVG `<title>`,
   * which a mouse gets and a keyboard user tabbing through never sees. Every
   * country is now reachable by keyboard (an `<a>` is already tabbable; a
   * multi-trip country's `<g>` gets its own `tabIndex={0}`) and carries its
   * name as an `aria-label` a screen reader reads regardless of hover state.
   */
  test("a single-trip country is a focusable link, not just a hover target", () => {
    const html = render([ONE]);
    expect(html).toMatch(/<a[^>]*href="\/u\/trips\/t1"[^>]*aria-label="Thailand — Trip one"/);
  });

  test("a multi-trip country is keyboard-focusable even though it is not a link", () => {
    const html = render([TWO]);
    expect(html).toMatch(/<g tabindex="0"[^>]*aria-label="United States of America — Trip one, Trip two"/);
  });

  test("no country names are written across the map — the legend does this job", () => {
    // B370: they landed in the sea, named the wrong country, and only 5 of 23
    // fitted. Trip markers are unnumbered dots (B2423 review), so there is no
    // `<text>` anywhere on this map at all any more.
    expect(render([ONE, TWO])).not.toContain("<text");
  });

  /**
   * A journal whose days carry no `country:` resolves no visits — `viki` is
   * exactly that. Filling nothing would render an empty world, which is worse
   * than the plain route this falls back to.
   */
  test("a journal with no country data still gets its trip's route and marker", () => {
    const html = render([]);
    expect(html).toContain("Trip one");
    expect(html).not.toContain("var(--map-visited)");
  });

  test("the svg stops calling itself an image once it contains links", () => {
    // role="img" promises nothing inside is reachable, which would hide every
    // country link from a screen reader.
    expect(render([ONE])).toContain('role="group"');
    expect(render([])).toContain('role="img"');
  });
});

/**
 * B364. The fill branch was drawing its countries on a bare coastline while
 * the branch beside it drew borders and lakes from the basemap the page was
 * already computing and passing in — one component, two answers to how much
 * map a map has.
 */
describe("map detail", () => {
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

  function withMap(extra: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <LifetimeMap routes={[route]} visits={[ONE]} userPath="/u" {...extra} />
      </LocaleProvider>,
    );
  }

  test("draws the basemap's borders, lakes and rivers under the fill", () => {
    const html = withMap({ basemap });
    expect(html).toContain("M0,0 L1,1 Z"); // borders
    expect(html).toContain("M2,2 L3,3 Z"); // lakes
    expect(html).toContain("M4,4 L5,5 Z"); // rivers
  });

  test("water is drawn after the fill, so a lake is never buried under it", () => {
    const html = withMap({ basemap });
    expect(html.indexOf(ONE.path)).toBeLessThan(html.indexOf("M2,2 L3,3 Z"));
  });

  test("a journal with no basemap still renders, on the plain outline", () => {
    expect(() => withMap()).not.toThrow();
  });

  test("no country names are written across the map", () => {
    expect(withMap({ basemap })).not.toContain("<text");
  });
});
