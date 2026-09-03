import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TripCountdown from "@/components/TripCountdown";
import CurrencyProvider from "@/components/CurrencyProvider";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import TripProvider from "@/components/TripProvider";
import TripListProvider from "@/components/TripListProvider";
import { basemapFor, basemapForRoute } from "@/lib/basemap";
import { frameRoute } from "@/lib/mapFrame";
import { dictionaryFor } from "@/lib/locales";
import type { PlannedStop, Trip } from "@/lib/types";

// The header reads the current URL to mark the active nav item, and the
// language switcher refreshes the route. There is no router here, only React.
vi.mock("next/navigation", () => ({
  usePathname: () => "/traveller/trips/next-year",
  useRouter: () => ({ refresh: () => {} }),
}));

/**
 * What an upcoming trip's page weighs.
 *
 * B85, measured: a trip with no `plan.md` draws no map — `TripCountdown`
 * renders `WorldMap` only when it has stops — and the page was still building
 * `basemapFor(frameRoute([]))` and serialising the result. `frameRoute([])` is
 * the whole world by design, so the clip clipped nothing.
 *
 * These assertions are about *bytes in the props the browser is handed*, not
 * about which helper does the guarding. Reconnect the two conditions by any
 * route and the numbers move.
 */

/** alps-2024's four stops, as a plan. */
const STOPS: PlannedStop[] = [
  { location: "Locarno", country: "Switzerland", lat: 46.1161, lng: 8.2939, reached: false },
  { location: "Ulrichen", country: "Switzerland", lat: 46.5614, lng: 8.3372, reached: false },
  { location: "Göschenen", country: "Switzerland", lat: 46.7297, lng: 8.4444, reached: false },
  { location: "Altdorf", country: "Switzerland", lat: 46.6364, lng: 8.5942, reached: false },
];

const TRIP = {
  id: "next-year",
  ref: "traveller/next-year",
  username: "traveller",
  title: "Next year, somewhere",
  start: "2027-05-01",
  end: "2027-05-20",
  status: "upcoming",
  accent: "yellow",
  intro: "Nothing planned yet.",
  entriesDir: "",
  dir: "",
  people: [],
  visibility: "public",
} as unknown as Trip;

const SITE = {
  name: "Traveller",
  title: "Traveller",
  tagline: "",
  url: "https://example.test",
  username: "traveller",
  locales: ["en"],
  defaultLocale: "en",
  baseCurrency: "CHF",
  isDefaultUser: true,
} as never;

function wrap(children: ReactNode) {
  return (
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={SITE}>
        <TripListProvider trips={[]}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            <TripProvider trip={TRIP} isCurrent={false}>
              {children}
            </TripProvider>
          </CurrencyProvider>
        </TripListProvider>
      </SiteProvider>
    </LocaleProvider>
  );
}

/**
 * The countdown as the trip page mounts it, counted the way a browser pays for
 * it: the markup, plus the props React serialises alongside to hydrate with.
 */
function render(stops: PlannedStop[]) {
  const basemap = basemapForRoute(stops);
  const markup = renderToStaticMarkup(
    wrap(createElement(TripCountdown, { trip: TRIP, stops, basemap })),
  );
  const props = JSON.stringify({ trip: TRIP, stops, basemap });
  return {
    basemap,
    markup,
    bytes: Buffer.byteLength(markup) + Buffer.byteLength(props),
  };
}

/** The heading the countdown only prints when it has a route to draw. */
const ROUTE_HEADING = dictionaryFor("en")["trips.plannedRoute"];

const built = basemapFor(frameRoute(STOPS)) !== null;

describe("the basemap a page is handed", () => {
  it("is null when there is no route to frame", () => {
    expect(basemapForRoute([])).toBeNull();
  });

  it.skipIf(!built)("is still built for a route that has stops", () => {
    const map = basemapForRoute(STOPS)!;
    expect(map).not.toBeNull();
    expect(map.borders.length).toBeGreaterThan(0);
    // Framed as before: the same frame `frameRoute` gives those stops.
    expect(map).toEqual(basemapFor(frameRoute(STOPS)));
  });

  /**
   * The size of what an unplanned trip used to carry. Not a limit anyone
   * should tune — it is the measurement the task was filed on, kept so that
   * "no basemap" stays worth something.
   */
  it.skipIf(!built)("would be six figures of bytes for the whole world", () => {
    const whole = JSON.stringify(basemapFor(frameRoute([])));
    expect(Buffer.byteLength(whole)).toBeGreaterThan(100_000);
  });
});

describe("an upcoming trip's countdown payload", () => {
  it("carries no basemap when there is no plan, and draws no map", () => {
    const page = render([]);
    expect(page.basemap).toBeNull();
    // The map section is the one thing a plan adds.
    expect(page.markup).not.toContain(ROUTE_HEADING);
    expect(page.markup).not.toContain("<svg viewBox");
    // Whole-world borders alone are ~160 KB. A countdown is a headline, a
    // date range and a paragraph.
    expect(page.bytes).toBeLessThan(30_000);
  });

  it.skipIf(!built)("still draws the map, with its basemap, when there is a plan", () => {
    const page = render(STOPS);
    expect(page.basemap).not.toBeNull();
    expect(page.markup).toContain(ROUTE_HEADING);
    expect(page.markup).toContain("<svg viewBox");
    // The basemap is in the payload because it is on the screen.
    expect(page.bytes).toBeGreaterThan(render([]).bytes);
  });
});
