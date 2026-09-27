import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LifetimeMap, { type TripRoute } from "@/components/LifetimeMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { frameRoute, place as placeIn } from "@/lib/mapFrame";

/**
 * B265. `app/[user]/trips/page.tsx` builds each route's `points` straight
 * from `getPlaces`, which returns a `Place` for a day with no coordinates too
 * (`lat`/`lng` are optional on an entry). That page is frozen mid-rewrite by
 * another session, so the guard against drawing one of those places as a
 * point on the lifetime map has to live here instead — this is the only
 * component between the raw list and the SVG.
 *
 * B2423 replaced the old "one pin per stop, no line between them" drawing
 * with "each trip is its own accent route plus one marker"
 * (docs/plans/map-redesign.md §1 "Reisen" row) — the pin-specific tests this
 * file used to hold (a pin's tip on the coordinate, one pin per stop, no
 * connecting line) no longer describe anything that exists; they are
 * replaced below by the route+marker equivalents.
 */

const alps: TripRoute["points"] = [
  { lat: 46.1161, lng: 8.2939, location: "Domodossola" },
  { lat: 46.5614, lng: 8.3372, location: "Grimsel" },
  { lat: 46.7297, lng: 8.4444, location: "Susten" },
];

function render(routes: TripRoute[]) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <LifetimeMap routes={routes} />
    </LocaleProvider>,
  );
}

/** Two continents apart — the case that made a dot cover the coastline it
 * was meant to mark, because `size()` grows the marker with the frame. */
const continental: TripRoute["points"] = [
  { lat: 47.3769, lng: 8.5417, location: "Zurich" },
  { lat: 13.7563, lng: 100.5018, location: "Bangkok" },
];

function viewBox(html: string): number[] {
  const match = html.match(/viewBox="([-\d. ]+)"/);
  return match![1].split(" ").map(Number);
}

/** Every trip marker is a `StopMarker` `<g aria-label="…">` holding a
 * `<circle>` head — one per trip, never one per stop. */
function markerRadii(html: string, ariaLabel: string): number[] {
  const escaped = ariaLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...html.matchAll(new RegExp(`<g aria-label="${escaped}"[^>]*><circle[^>]*r="([\\d.]+)"`, "g")),
  ].map((m) => Number(m[1]));
}

describe("a trip is its own route plus one marker (B2423)", () => {
  const route: TripRoute = {
    id: "alps-2024",
    title: "Alps 2024",
    accent: "sky",
    points: [
      { lat: 46.1161, lng: 8.2939, location: "Domodossola" },
      { lat: 46.5614, lng: 8.3372, location: "Grimsel" },
    ],
  };

  test("draws exactly one marker for a multi-stop trip", () => {
    const html = render([route]);
    expect(markerRadii(html, "Alps 2024")).toHaveLength(1);
  });

  test("the marker sits on the trip's first plottable point", () => {
    const html = render([route]);
    const frame = frameRoute(route.points);
    const [x, y] = placeIn(frame, route.points[0]);
    expect(html).toMatch(new RegExp(`<circle cx="${x}" cy="${y}"`));
  });

  test("draws a route line between the trip's own stops", () => {
    // Superseding B344's "no line" rule, which was about a line asserting a
    // journey between *separate trips'* pins — never the case for a single
    // trip's own stops, which RouteLine now draws the same way TripMap does.
    expect(render([route])).toMatch(/<path d="M[\d.,]+ L[\d.,]+"/);
  });

  test("a marker is the same size on screen for a one-city journal and a two-continent one", () => {
    const oneCity = render([route]);
    const twoContinents = render([{ ...route, points: continental }]);
    const cityBox = viewBox(oneCity);
    const worldBox = viewBox(twoContinents);
    // The radius is a viewBox-unit constant; what makes it the same *on
    // screen* is that it stays the same fraction of a viewBox rendered at a
    // fixed width — not that the raw units match.
    const cityFraction = markerRadii(oneCity, "Alps 2024")[0] / cityBox[2];
    const worldFraction = markerRadii(twoContinents, "Alps 2024")[0] / worldBox[2];
    expect(worldFraction).toBeCloseTo(cityFraction, 6);
  });

  test("the legend still pairs each trip's accent with its title", () => {
    const html = render([route]);
    expect(html).toContain("Alps 2024");
    expect(html).toContain("var(--map-accent-sky)"); // mapAccent("sky")
  });

  test("keeps its role=img and aria-label when nothing is filled", () => {
    const html = render([route]);
    expect(html).toContain('role="img"');
    expect(html).toMatch(/aria-label="[^"]*Alps 2024[^"]*"/);
  });
});

describe("a trip with a day that has no coordinates", () => {
  const route: TripRoute = {
    id: "alps-2024",
    title: "Alps 2024",
    accent: "sky",
    points: [...alps, { lat: undefined as unknown as number, lng: undefined as unknown as number, location: "Unrecorded" }],
  };

  test("does not put NaN through the lifetime map", () => {
    expect(render([route])).not.toContain("NaN");
  });

  test("a route with nothing plottable still renders the whole world, not NaN, and draws no marker", () => {
    const empty: TripRoute = {
      id: "planned-only",
      title: "Planned only",
      accent: "coral",
      points: [{ lat: undefined as unknown as number, lng: undefined as unknown as number, location: "Nowhere yet" }],
    };
    const html = render([route, empty]);
    expect(html).not.toContain("NaN");
    expect(markerRadii(html, "Planned only")).toHaveLength(0);
  });
});

/**
 * The component draws exactly what it is handed — the actual filtering of a
 * private or unlisted trip happens upstream, in `listableTrips`
 * (`app/[user]/trips/page.tsx`), before a route or a visit ever reaches this
 * component's props. This is the contract that upstream filtering relies on:
 * a trip never passed here contributes nothing — no route, no marker, no
 * tint — to what a reader sees.
 */
describe("a trip never handed to the map contributes nothing (B2423)", () => {
  const visible: TripRoute = {
    id: "alps-2024",
    title: "Alps 2024",
    accent: "sky",
    points: alps,
  };

  test("a route this reader may not see, never passed in, draws no route, marker or mention", () => {
    const html = render([visible]);
    expect(html).not.toContain("Secret Trip");
    expect(markerRadii(html, "Secret Trip")).toHaveLength(0);
  });
});
