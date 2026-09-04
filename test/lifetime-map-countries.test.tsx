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

  test("more visits is a deeper fill", () => {
    const html = render([ONE, TWO]);
    expect(html).toContain("#f0bcc4"); // one visit
    expect(html).toContain("#c2334a"); // two, darker
  });

  test("the legend counts visits rather than naming trips", () => {
    const html = render([ONE]);
    expect(html).toContain("1 visit");
    expect(html).not.toContain("Trip one</span>");
  });

  test("no pins are drawn over the fill", () => {
    // The stems are what made the smear; drawing both would reinstate it.
    expect(render([ONE])).not.toContain('<line x1="0" y1="0"');
  });

  /**
   * A journal whose days carry no `country:` resolves no visits — `viki` is
   * exactly that. Filling nothing would render an empty world, which is worse
   * than the pins this replaced.
   */
  test("a journal with no country data still gets its pins", () => {
    const html = render([]);
    expect(html).toContain('<line x1="0" y1="0"');
    expect(html).toContain("Trip one");
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

  test("names the countries it is given, and nothing else", () => {
    const html = withMap({ labels: [{ code: "TH", name: "Thailand", x: 780, y: 213 }] });
    expect(html).toContain("Thailand");
    expect(html).not.toContain("France");
  });

  test("a country with no label still keeps its fill", () => {
    // The crowding guard drops names, never countries.
    const html = withMap({ labels: [] });
    expect(html).toContain(ONE.path);
  });
});
