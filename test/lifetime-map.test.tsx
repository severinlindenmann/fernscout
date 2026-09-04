import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LifetimeMap, { type TripRoute } from "@/components/LifetimeMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B265. `app/[user]/trips/page.tsx` builds each route's `points` straight
 * from `getPlaces`, which returns a `Place` for a day with no coordinates too
 * (`lat`/`lng` are optional on an entry). That page is frozen mid-rewrite by
 * another session, so the guard against drawing one of those places as a
 * point on the lifetime map has to live here instead — this is the only
 * component between the raw list and the SVG.
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

/** Every pin is a `<g translate(x y)>` holding a stem `<line>` from its local
 * origin (the coordinate) and a `<circle>` head above it — the origin is the
 * tip, translated onto the map. */
function pins(html: string): { x: number; y: number; headRadius: number }[] {
  return [
    ...html.matchAll(
      /<g transform="translate\(([-\d.]+) ([-\d.]+)\)"><line x1="0" y1="0"[^>]*>(?:<\/line>)?<circle[^>]*r="([\d.]+)"/g,
    ),
  ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), headRadius: Number(m[3]) }));
}

/**
 * B88. A dot is centred on the coordinate and covers it; a pin's tip is the
 * coordinate and its body sits above the ground, so the map underneath the
 * point stays visible.
 */
describe("stops drawn as pins, not dots", () => {
  const route: TripRoute = {
    id: "alps-2024",
    title: "Alps 2024",
    accent: "sky",
    points: [
      { lat: 46.1161, lng: 8.2939, location: "Domodossola" },
      { lat: 46.5614, lng: 8.3372, location: "Grimsel" },
    ],
  };

  test("a pin's tip sits on the coordinate the route line joins", () => {
    const html = render([route]);
    const found = pins(html);
    expect(found).toHaveLength(route.points.length);
    const line = html.match(/<polyline points="([^"]+)"/)![1];
    const joined = line.split(" ").map((pair) => pair.split(",").map(Number));
    for (const [i, pin] of found.entries()) {
      expect(pin.x).toBeCloseTo(joined[i][0], 6);
      expect(pin.y).toBeCloseTo(joined[i][1], 6);
    }
  });

  test("a pin is the same size on screen for a one-city journal and a two-continent one", () => {
    const oneCity = render([route]);
    const twoContinents = render([{ ...route, points: continental }]);
    const cityBox = viewBox(oneCity);
    const worldBox = viewBox(twoContinents);
    // The radius is a viewBox-unit constant; what makes it the same *on
    // screen* is that it stays the same fraction of a viewBox rendered at a
    // fixed width — not that the raw units match.
    const cityFraction = pins(oneCity)[0].headRadius / cityBox[2];
    const worldFraction = pins(twoContinents)[0].headRadius / worldBox[2];
    expect(worldFraction).toBeCloseTo(cityFraction, 6);
  });

  test("the legend still pairs each trip's colour with its title", () => {
    const html = render([route]);
    expect(html).toContain("Alps 2024");
    expect(html).toContain("#3fa9c4"); // ACCENT_HEX.sky
  });

  test("keeps its role=img and aria-label rather than becoming markers a screen reader enumerates", () => {
    const html = render([route]);
    expect(html).toContain('role="img"');
    expect(html).toMatch(/aria-label="[^"]*Alps 2024[^"]*"/);
    expect(html).not.toContain("role=\"button\"");
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

  test("a route with nothing plottable still renders the whole world, not NaN", () => {
    const empty: TripRoute = {
      id: "planned-only",
      title: "Planned only",
      accent: "coral",
      points: [{ lat: undefined as unknown as number, lng: undefined as unknown as number, location: "Nowhere yet" }],
    };
    expect(render([route, empty])).not.toContain("NaN");
  });
});
