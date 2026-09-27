// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LifetimeMap, { type TripRoute } from "@/components/LifetimeMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { frameRoute, place as placeIn } from "@/lib/mapFrame";

// jsdom has no ResizeObserver, and the map measures its own rendered width
// with one to size markers and routes in real screen pixels rather than a
// fraction of the viewBox — the same reason `test/trip-map.test.tsx` stubs
// one. This one is controllable (`fire`), so the "screen pixels" tests below
// can simulate the SVG actually being laid out at a chosen width.
let resizeCallback: ((entries: { contentRect: { width: number } }[]) => void) | null = null;
class ControllableResizeObserver {
  constructor(cb: (entries: { contentRect: { width: number } }[]) => void) {
    resizeCallback = cb;
  }
  observe() {}
  disconnect() {
    resizeCallback = null;
  }
}
function fireResize(width: number) {
  act(() => resizeCallback?.([{ contentRect: { width } }]));
}
globalThis.ResizeObserver ??= ControllableResizeObserver as unknown as typeof ResizeObserver;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function mount(routes: TripRoute[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <LifetimeMap routes={routes} />
      </LocaleProvider>,
    );
  });
  return container;
}

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

/** A marker's own centre, in viewBox units — for checking two trips'
 * markers actually sit apart on screen. */
function markerCentres(html: string, ariaLabel: string): { x: number; y: number }[] {
  const escaped = ariaLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...html.matchAll(
      new RegExp(`<g aria-label="${escaped}"[^>]*><circle cx="([-\\d.]+)" cy="([-\\d.]+)"`, "g"),
    ),
  ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
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

/**
 * B2423 review. The first version reused the fraction-of-viewBox `size()`
 * this file's own pin tests already relied on — correct for those tiny pin
 * units, but wrong once applied to a normal-sized marker and a 4px route:
 * a lifetime map's frame swings from one country to six continents, so a
 * fraction of *that* viewBox is a wildly different number of real pixels
 * trip to trip, and at world scale the marker came out the size of a small
 * country. The fix measures the SVG's own rendered width with a
 * `ResizeObserver` (`components/WorldMap.tsx`'s own `px`, same reasoning),
 * so a marker or a route stroke is a constant number of *actual* screen
 * pixels — independent of how large an area the frame covers.
 */
describe("markers and routes are sized in real screen pixels, not a fraction of the viewBox (B2423 review)", () => {
  const compact: TripRoute = {
    id: "compact",
    title: "Compact trip",
    accent: "sky",
    points: [
      { lat: 46.1161, lng: 8.2939, location: "Domodossola" },
      { lat: 46.5614, lng: 8.3372, location: "Grimsel" },
    ],
  };

  test("a marker's radius and a route's stroke width follow the measured render width", () => {
    // The map's ground (`worldLand`) is drawn with a fixed `strokeWidth={1}`
    // on its wrapping `<g>` — the one `stroke-width` in this markup that is
    // *not* sized through `px()` — so it is dropped (`slice(1)`) before
    // checking that everything else (the route's casing, its accent stroke,
    // the marker's own ring) scales with the measured width.
    function strokes(html: string): number[] {
      return [...html.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1])).slice(1);
    }

    const el = mount([compact]);
    fireResize(900);
    const wideRadius = markerRadii(el.innerHTML, "Compact trip")[0];
    const wideStrokes = strokes(el.innerHTML);

    fireResize(450);
    const narrowRadius = markerRadii(el.innerHTML, "Compact trip")[0];
    const narrowStrokes = strokes(el.innerHTML);

    // Halving the measured width means each viewBox unit now covers *fewer*
    // real pixels, so it takes *twice* the viewBox-unit size to draw the
    // same real screen pixels — the old `/140` constant never looked at the
    // measured width at all, so it could not do this.
    expect(narrowRadius).toBeCloseTo(wideRadius * 2, 5);
    expect(narrowStrokes.length).toBeGreaterThan(0);
    expect(narrowStrokes.length).toBe(wideStrokes.length);
    for (let i = 0; i < narrowStrokes.length; i++) {
      expect(narrowStrokes[i]).toBeCloseTo(wideStrokes[i] * 2, 5);
    }
  });

  test("two trips with wildly different geographic extents draw the same size marker at the same measured width", () => {
    // Two continents apart vs a few kilometres apart — the frame (`view.w`)
    // is wildly different between these two, so the raw viewBox-unit radius
    // attribute is expected to differ too (bigger frame, bigger raw unit).
    // What must not differ is the *real* screen pixel size that raw radius
    // and the measured width imply together — `raw * drawnWidth / view.w`.
    function screenRadiusAt(route: TripRoute): number {
      const el = mount([route]);
      fireResize(900);
      const html = el.innerHTML;
      const raw = markerRadii(html, route.title)[0];
      const vw = viewBox(html)[2];
      act(() => root?.unmount());
      container?.remove();
      root = undefined;
      container = undefined;
      return (raw * 900) / vw;
    }

    const smallScreenRadius = screenRadiusAt(compact);
    const worldScreenRadius = screenRadiusAt({
      id: "worldwide",
      title: "Worldwide trip",
      accent: "coral",
      points: continental,
    });
    expect(worldScreenRadius).toBeCloseTo(smallScreenRadius, 5);
  });

  test("two trips whose markers would otherwise overlap are nudged apart", () => {
    // The trip that made the case for this fix: two US trips whose real
    // starting points are a few hundred kilometres apart, on a frame that
    // also has to reach across the Pacific to Southeast Asia — nothing at
    // that zoom. Reproduced here as a Zurich trip and a second trip that
    // starts a short drive from Zurich, framed alongside a trip to Bangkok.
    const zurich: TripRoute = {
      id: "zurich",
      title: "Zurich trip",
      accent: "sky",
      points: continental, // Zurich, Bangkok
    };
    const near: TripRoute = {
      id: "near",
      title: "Near trip",
      accent: "coral",
      points: [{ lat: 47.05, lng: 8.3, location: "Near Zurich" }],
    };
    const el = mount([zurich, near]);
    fireResize(900);
    const html = el.innerHTML;

    // Without decluttering, the two would be much closer than the minimum
    // gap this pass enforces — otherwise this test would prove nothing.
    const vw = viewBox(html)[2];
    const frame = frameRoute([...zurich.points, ...near.points]);
    const [rawX1, rawY1] = placeIn(frame, zurich.points[0]);
    const [rawX2, rawY2] = placeIn(frame, near.points[0]);
    const rawDistancePx = (Math.hypot(rawX2 - rawX1, rawY2 - rawY1) * 900) / vw;
    const minGapPx = 8 * 2.4; // MARKER_RADIUS_PX * the component's own factor
    expect(rawDistancePx).toBeLessThan(minGapPx);

    const zurichPos = markerCentres(html, "Zurich trip")[0];
    const nearPos = markerCentres(html, "Near trip")[0];
    const distancePx = (Math.hypot(zurichPos.x - nearPos.x, zurichPos.y - nearPos.y) * 900) / vw;
    expect(distancePx).toBeGreaterThanOrEqual(minGapPx - 0.01);
  });
});
