import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import MiniMap from "@/components/MiniMap";
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

/**
 * Which way a long leg bends.
 *
 * The perpendicular alone bows whichever way the leg happens to run, so the
 * demo's Zurich–Bangkok flight came out sweeping south over Africa — the
 * opposite of the great circle every such flight follows, and wrong in a way
 * anyone who has taken one would notice.
 */
describe("a long leg bends toward the nearer pole", () => {
  /** The control point of the one quadratic path on the map. */
  function control(html: string): { x: number; y: number } | null {
    const match = html.match(/d="M[-\d.]+,[-\d.]+ Q([-\d.]+),([-\d.]+) /);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
  }

  function flightBetween(a: PlaceView, b: PlaceView) {
    const arriving: PlaceView = {
      ...b,
      entries: [{ slug: b.key, date: "2023-01-09", transport: { mode: "flight", from: a.location, to: b.location } } as unknown as Entry],
    };
    return renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <WorldMap places={[a, arriving]} />
      </LocaleProvider>,
    );
  }

  const zurich = stop("Zurich", 47.3769, 8.5417);
  const bangkok = stop("Bangkok", 13.7563, 100.5018);

  test("northern hemisphere: the arc goes north of the straight line", () => {
    const c = control(flightBetween(zurich, bangkok));
    expect(c).not.toBeNull();
    // y grows southward, so north of the midpoint means a smaller y.
    const midY = (47.3769 + 13.7563) / 2;
    const midYUnits = (90 - midY) / 180 * 500;
    expect(c!.y).toBeLessThan(midYUnits);
  });

  test("it bends the same way whichever end it starts from", () => {
    const there = control(flightBetween(zurich, bangkok));
    const back = control(flightBetween(bangkok, zurich));
    // Both arcs sit on the same side of the route; a sign flip here is the
    // bug where an eastbound and a westbound flight bow opposite ways.
    const midYUnits = (90 - (47.3769 + 13.7563) / 2) / 180 * 500;
    expect(there!.y).toBeLessThan(midYUnits);
    expect(back!.y).toBeLessThan(midYUnits);
  });

  test("southern hemisphere: the arc goes south", () => {
    const perth = stop("Perth", -31.95, 115.86);
    const joburg = stop("Johannesburg", -26.2, 28.05);
    const c = control(flightBetween(joburg, perth));
    const midYUnits = (90 - (-31.95 + -26.2) / 2) / 180 * 500;
    expect(c!.y).toBeGreaterThan(midYUnits);
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

/**
 * B265. `getPlaces` returns a `Place` for a day with no coordinates too — it
 * still has entries, nights and a media count — so this component has to
 * receive one and draw a route through the days that were located without
 * reaching for the one that wasn't.
 */
describe("a day with no coordinates", () => {
  const noCoords: PlaceView = {
    ...stop("Somewhere unrecorded", 0, 0),
    lat: undefined as unknown as number,
    lng: undefined as unknown as number,
  };

  test("does not put NaN through the map", () => {
    expect(render([...alps, noCoords])).not.toContain("NaN");
  });

  test("draws a marker for every located day, and none for the one that wasn't", () => {
    expect(markers(render([...alps, noCoords]))).toHaveLength(alps.length);
  });

  test("a trip where nothing is located still renders — the whole world, not NaN", () => {
    const html = render([noCoords]);
    expect(html).not.toContain("NaN");
    expect(markers(html)).toHaveLength(0);
  });
});

/**
 * The hero's small map, which had the same bug and kept it two commits longer
 * than the others: B46 gave MiniMap the shared frame but left its pin at
 * `r={9}` viewBox units. Framed on `alps-2024` — 4.6 units wide — the pin came
 * out twice as wide as the map and the trip page rendered as a solid yellow
 * rectangle.
 */
describe("the hero's mini map", () => {
  function renderMini(route: { lat: number; lng: number }[]) {
    return renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <MiniMap route={route} current={route[route.length - 1]} />
      </LocaleProvider>,
    );
  }

  test("draws a pin, not a yellow rectangle", () => {
    const html = renderMini(alps);
    const [, , w] = viewBox(html);
    const radii = [...html.matchAll(/\br="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(radii.length).toBeGreaterThan(0);
    // The pulsing ring is the largest circle on it and still has to be a mark
    // on the map rather than the whole of it.
    for (const r of radii) expect(r).toBeLessThan(w / 4);
  });

  test("frames the route it was given", () => {
    const [, , w] = viewBox(renderMini(alps));
    expect(kmForUnits(w)).toBeLessThan(250);
  });

  /**
   * B265. `route` here comes from `DaySummary[]`, which carries the same
   * unchecked `lat`/`lng` as `Place` — a day with no coordinates reaches
   * this component too.
   */
  test("a day with no coordinates does not put NaN through the pin map", () => {
    const noCoords = { lat: undefined as unknown as number, lng: undefined as unknown as number };
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <MiniMap route={[...alps, noCoords]} current={alps[alps.length - 1]} />
      </LocaleProvider>,
    );
    expect(html).not.toContain("NaN");
  });

  /** The pin itself — "where we are right now" — is withheld rather than
   * drawn at (0, 0) when `current` has no coordinates. */
  test("an unlocated current position draws no pin, and no NaN", () => {
    const noCoords = { lat: undefined as unknown as number, lng: undefined as unknown as number };
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <MiniMap route={alps} current={noCoords} />
      </LocaleProvider>,
    );
    expect(html).not.toContain("NaN");
  });
});
