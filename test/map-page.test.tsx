import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MapPageContent from "@/app/[user]/(trip)/map/MapPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { PlaceView } from "@/components/WorldMap";
import type { SiteSummary } from "@/lib/site";
import type { Entry, PlannedStop } from "@/lib/types";

/**
 * What the map page draws, and for which of the two kinds of trip.
 *
 * B18: the map was gated on published entries, so an upcoming trip — the one
 * most likely to be shared before there is anything else to show — got "no
 * entries yet" and, directly underneath, a legend for the planned route it had
 * just refused to draw. `WorldMap` had been able to frame a plan since it was
 * written; it was never given one.
 *
 * The three cases below are the whole of the decision: days, a plan, or
 * neither.
 */

// The page draws the header, which links and reads the path.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/trips/japan-2027/map",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const site = {
  username: "alex",
  title: "Alex's journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  hasAccessPanel: false,
} as unknown as SiteSummary;

/** Two of the eight real stops in the demo trip, far enough apart to frame. */
const planned: PlannedStop[] = [
  { location: "Fukuoka", country: "Japan", countryCode: "JP", lat: 33.5904, lng: 130.4017, reached: false },
  { location: "Sapporo", country: "Japan", countryCode: "JP", lat: 43.0618, lng: 141.3545, reached: false },
];

const place: PlaceView = {
  key: "kyoto",
  location: "Kyoto",
  country: "Japan",
  countryCode: "JP",
  lat: 35.0116,
  lng: 135.7681,
  firstDate: "2027-04-08",
  lastDate: "2027-04-10",
  nights: 2,
  mediaCount: 4,
  entries: [{ slug: "kyoto-in-april", date: "2027-04-08" } as Entry],
};

const travelled = { tripDays: 3, places: 1, countries: 1, totalMedia: 4 };
const nothing = { tripDays: 0, places: 0, countries: 0, totalMedia: 0 };

function render(props: {
  places?: PlaceView[];
  plan?: PlannedStop[];
  stats?: typeof travelled;
  reachedCount?: number;
}) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <MapPageContent
              places={props.places ?? []}
              plan={props.plan ?? []}
              stats={props.stats ?? nothing}
              reachedCount={props.reachedCount ?? 0}
            />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

/**
 * Rendered markup with entities turned back into the characters they stand for.
 *
 * `renderToStaticMarkup` escapes the apostrophe in "Where we've been" to
 * `&#x27;`, so asserting against the dictionary string directly fails on copy
 * that is on the page and correct. Comparing decoded text keeps the assertions
 * about the words rather than about React's escaping.
 */
function text(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** The map itself, told apart from the page's lucide icons by its viewBox —
 * theirs is always the 24×24 the icon set is drawn on. */
function mapViewBox(html: string): string | null {
  const boxes = [...html.matchAll(/viewBox="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((b) => b !== "0 0 24 24");
  return boxes[0] ?? null;
}

describe("an upcoming trip: a plan and no days", () => {
  test("draws the map, framed on the planned route", () => {
    const html = render({ plan: planned });

    const box = mapViewBox(html);
    expect(box).not.toBeNull();

    // Framed on Japan rather than standing the whole world in. The plan spans
    // lng 130.4–141.4, which the equirectangular projection of
    // lib/mapProjection.mjs puts at x 862–893 in a 1000-wide viewBox.
    const [x, , w] = box!.split(" ").map(Number);
    expect(x).toBeGreaterThan(700);
    expect(x + w).toBeLessThan(1000);
  });

  test("draws every planned stop, on a dashed run", () => {
    const html = render({ plan: planned });
    // The hollow markers of WorldMap's planned run, one per stop.
    expect([...html.matchAll(/fill="#fffaf0"/g)]).toHaveLength(planned.length);
    expect(html).toContain("stroke-dasharray");
  });

  test("no longer says there are no entries", () => {
    const html = render({ plan: planned });
    expect(html).not.toContain(dictionaryFor("en")["story.empty"]);
    expect(html).not.toContain(dictionaryFor("en")["map.empty"]);
  });

  /**
   * The statistics all count travel that has happened, and a trip that has not
   * started has an honest answer for none of them. Four zeroes claimed it did
   * and the answer was nothing.
   */
  test("withholds the statistics rather than reporting zeroes", () => {
    const html = render({ plan: planned });
    expect(html).not.toContain(dictionaryFor("en")["map.days"]);
    expect(html).not.toContain(dictionaryFor("en")["map.media"]);
  });

  test("withholds the empty list of stops, and lists what is still to come", () => {
    const html = render({ plan: planned });
    expect(html).not.toContain(dictionaryFor("en")["map.everyStop"]);
    expect(html).toContain(dictionaryFor("en")["map.stillToCome"]);
    expect(html).toContain("Fukuoka");
  });

  /**
   * B54. "Where we've been" is a claim, and over eight places nobody has been
   * to it is a false one. The subtitle was worse: it invited the reader to tap
   * stops that do not exist, since the only markers are planned and they open
   * nothing.
   */
  test("is titled for a journey ahead, not one already made", () => {
    const html = text(render({ plan: planned }));
    expect(html).toContain(dictionaryFor("en")["map.titlePlanned"]);
    expect(html).toContain(dictionaryFor("en")["map.subtitlePlanned"]);
    expect(html).not.toContain(dictionaryFor("en")["map.title"]);
    expect(html).not.toContain(dictionaryFor("en")["map.subtitle"]);
  });

  /**
   * The heading was not the only place the claim was made. `WorldMap` names
   * itself with `map.title`, and that name is the whole of what a screen
   * reader is told about the picture — so fixing only the h1 would have left
   * the past tense in the one place nobody sighted would ever catch it.
   */
  test("does not announce itself to a screen reader as somewhere we have been", () => {
    const html = text(render({ plan: planned }));
    expect(html).toContain(`aria-label="${dictionaryFor("en")["map.titlePlanned"]}"`);
    expect(html).not.toContain(`aria-label="${dictionaryFor("en")["map.title"]}"`);
  });

  test("says so in every language the journal ships", () => {
    for (const locale of ["en", "de", "hu"] as const) {
      const dict = dictionaryFor(locale);
      // The pair has to exist and differ, or one locale silently keeps the
      // past tense while the others are fixed.
      expect(dict["map.titlePlanned"]).toBeTruthy();
      expect(dict["map.subtitlePlanned"]).toBeTruthy();
      expect(dict["map.titlePlanned"]).not.toBe(dict["map.title"]);
      expect(dict["map.subtitlePlanned"]).not.toBe(dict["map.subtitle"]);
    }
  });
});

describe("a trip with days", () => {
  test("is unchanged: map, statistics and every stop", () => {
    const html = render({ places: [place], stats: travelled });
    expect(mapViewBox(html)).not.toBeNull();
    expect(html).toContain(dictionaryFor("en")["map.days"]);
    expect(html).toContain(dictionaryFor("en")["map.everyStop"]);
    expect(html).toContain("Kyoto");
    expect(html).not.toContain(dictionaryFor("en")["map.empty"]);
  });

  test("keeps the past tense, which is true of it", () => {
    const html = text(render({ places: [place], stats: travelled }));
    expect(html).toContain(dictionaryFor("en")["map.title"]);
    expect(html).toContain(dictionaryFor("en")["map.subtitle"]);
    expect(html).not.toContain(dictionaryFor("en")["map.titlePlanned"]);
  });
});

describe("a trip with neither days nor a plan", () => {
  test("says there is nothing to draw, and draws nothing", () => {
    const html = render({});
    expect(mapViewBox(html)).toBeNull();
    expect(html).toContain(dictionaryFor("en")["map.empty"]);
    // The old message was true and was not the reason the map was missing.
    expect(html).not.toContain(dictionaryFor("en")["story.empty"]);
  });
});
