import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { kmForUnits } from "@/lib/mapFrame";
import type { Entry } from "@/lib/types";

/**
 * What the map draws at the scale of one trip.
 *
 * B46. Four constants in this component each assumed a route measured in
 * continents: the framing padding, the zoom cap, the cluster merge radius, and
 * — found only when the first three were fixed and the map rendered as a blank
 * white rectangle — every marker radius and stroke width on it.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function stop(location: string, lat: number, lng: number): PlaceView {
  return {
    key: location,
    location,
    country: "Switzerland",
    countryCode: "CH",
    lat,
    lng,
    firstDate: "2024-09-12",
    lastDate: "2024-09-12",
    nights: 1,
    mediaCount: 1,
    entries: [{ slug: location.toLowerCase(), date: "2024-09-12" } as Entry],
  };
}

/** alps-2024: four stops inside 68 km, the case B46 was opened for. */
const alps = [
  stop("Domodossola", 46.1161, 8.2939),
  stop("Grimsel", 46.5614, 8.3372),
  stop("Susten", 46.7297, 8.4444),
  stop("Andermatt", 46.6364, 8.5942),
];

/** asia-2023-shaped: stops a continent apart, which must still cluster. */
const continental = [
  stop("Bangkok", 13.7563, 100.5018),
  stop("Hanoi", 21.0278, 105.8342),
  stop("Tokyo", 35.6762, 139.6503),
];

function render(places: PlaceView[]) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <WorldMap places={places} />
    </LocaleProvider>,
  );
}

function viewBox(html: string): number[] {
  const match = html.match(/viewBox="([-\d. ]+)"/);
  return match![1].split(" ").map(Number);
}

/** Every stop marker is a focusable group carrying the place's name. */
function markers(html: string): string[] {
  return [...html.matchAll(/role="button" tabindex="0" aria-label="([^"]+)"/g)].map((m) => m[1]);
}

describe("a trip inside one valley", () => {
  test("is framed on the valley, not on a continent", () => {
    const [, , w] = viewBox(render(alps));
    // Was 5,650 km before B46. The trip itself is 68 km across.
    expect(kmForUnits(w)).toBeLessThan(250);
  });

  /**
   * The four Alpine passes merged into a single "4" marker that could not be
   * separated at any zoom the UI offered, because the merge radius was 80 km
   * even fully zoomed in and the whole trip is 68 km wide.
   */
  test("draws each stop as its own marker", () => {
    expect(markers(render(alps))).toHaveLength(alps.length);
  });

  /**
   * The blank-rectangle bug. Marker radii were viewBox constants sized for a
   * ~140-unit frame; against a 4.6-unit frame a radius-8 white circle covered
   * the entire map. Any marker wider than the frame means they have gone back
   * to being absolute.
   */
  test("draws markers smaller than the map they are on", () => {
    const html = render(alps);
    const [, , w] = viewBox(html);
    const radii = [...html.matchAll(/\br="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) expect(r).toBeLessThan(w / 2);
  });
});

/**
 * B46's own acceptance case: stops inside about ten kilometres. A day spent
 * walking one city is the smallest thing a journal will ever ask this map to
 * draw, and under the old fixed padding it was the purest form of the bug — a
 * single dot on five and a half thousand kilometres.
 */
describe("a day inside one city", () => {
  const zurich = [
    stop("Hauptbahnhof", 47.3779, 8.5403),
    stop("Bellevue", 47.3667, 8.5453),
    stop("Zürichhorn", 47.3548, 8.5528),
    stop("Uetliberg", 47.3499, 8.4917),
  ];

  test("is framed on the city, not the country", () => {
    const [, , w] = viewBox(render(zurich));
    // The walk spans about 6 km. Anything over ~60 means the padding is still
    // being decided by something other than the route.
    expect(kmForUnits(w)).toBeLessThan(60);
  });

  test("still draws each stop separately", () => {
    expect(markers(render(zurich))).toHaveLength(zurich.length);
  });

  test("draws markers that fit inside the map", () => {
    const html = render(zurich);
    const [, , w] = viewBox(html);
    for (const m of html.matchAll(/\br="([\d.]+)"/g)) {
      expect(Number(m[1])).toBeLessThan(w / 2);
    }
  });
});

describe("a trip across a continent", () => {
  test("still frames the whole route", () => {
    const [, , w] = viewBox(render(continental));
    // Bangkok to Tokyo is about 4,600 km.
    expect(kmForUnits(w)).toBeGreaterThan(4600);
  });

  test("still draws a marker per stop when they are far apart", () => {
    expect(markers(render(continental))).toHaveLength(continental.length);
  });

  /**
   * Clustering is not gone, only measured against the drawing rather than the
   * ground: two stops in the same city collapse, because their markers would
   * otherwise sit on top of each other.
   */
  test("still collapses stops that would overlap", () => {
    const sameCity = [
      stop("Shibuya", 35.6595, 139.7005),
      stop("Shinjuku", 35.6896, 139.7006),
      stop("Bangkok", 13.7563, 100.5018),
    ];
    expect(markers(render(sameCity)).length).toBeLessThan(sameCity.length);
  });
});
