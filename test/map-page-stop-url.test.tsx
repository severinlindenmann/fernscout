// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import MapPageContent from "@/app/at/[user]/(trip)/map/MapPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { PlaceView } from "@/components/WorldMap";
import type { SiteSummary } from "@/lib/site";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { PlaceEntry } from "@/lib/types";

/**
 * `?day=<date>` on the map page (B2537, was `?stop=<key>` before this ticket
 * moved the page's own selection from a merged-stay "place" to a calendar
 * day) — a shared link opens the same day the reader already sees and
 * nothing more, and picking a day keeps the URL in sync without spamming the
 * back stack or jumping the scroll position.
 *
 * The privacy rule ("never select or reveal a stop the reader cannot already
 * see", AGENTS.md) is not a second check written here — it falls out of
 * matching only against `places`/`plottable`, the same reader-filtered array
 * the map and the sheet already draw from. A draft or hidden day's date was
 * never in that array to begin with, so it and a wholly made-up date are the
 * same case below: neither matches anything, and nothing is selected.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/trips/alps-2024/map",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// Keep the real street overlay; replace only MapLibre's WebGL boundary.
const street = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  getSource: vi.fn(() => ({ setData: vi.fn() })),
  getLayer: vi.fn(() => ({})),
  getZoom: vi.fn(() => 10),
  isStyleLoaded: () => true,
  on: vi.fn(), off: vi.fn(), once: vi.fn(),
}));
vi.mock("@/components/map/StreetMap", () => ({
  default: ({ onReady }: { onReady: (map: MapLibreMap) => void }) => {
    useEffect(() => onReady(street as unknown as MapLibreMap), [onReady]);
    return <div data-street-map />;
  },
}));
vi.mock("maplibre-gl", () => ({
  Marker: class {
    element: HTMLElement;
    constructor({ element }: { element: HTMLElement }) { this.element = element; }
    setLngLat() { return this; }
    addTo() { document.querySelector("[data-street-map]")!.append(this.element); return this; }
    getElement() { return this.element; }
    remove() { this.element.remove(); }
  },
}));

// jsdom has no ResizeObserver, and WorldMap measures itself with one.
class StubResizeObserver {
  observe() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

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

function place(key: string, location: string, date: string, lat: number, lng: number): PlaceView {
  return {
    key,
    location,
    country: "Switzerland",
    countryCode: "CH",
    lat,
    lng,
    firstDate: date,
    lastDate: date,
    nights: 1,
    mediaCount: 1,
    entries: [
      {
        slug: key,
        date,
        location,
        country: "Switzerland",
        countryCode: "CH",
        gallery: [],
        headline: {},
      } as unknown as PlaceEntry,
    ],
  };
}

// Far enough apart (68 km — the same Alps fixture as test/trip-map.test.tsx)
// that they draw as two separate markers rather than one merged cluster.
const places = [
  place("furka-2024-09-01", "Furka", "2024-09-01", 46.5713, 8.4113),
  place("susten-2024-09-02", "Susten", "2024-09-02", 46.7264, 8.4456),
];
const stats = { tripDays: 2, places: 2, countries: 1, totalMedia: 2 };

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  window.history.replaceState(null, "", "/alex/trips/alps-2024/map");
});

function render(search: string, props: Partial<React.ComponentProps<typeof MapPageContent>> = {}) {
  street.fitBounds.mockClear();
  window.history.replaceState(null, "", `/alex/trips/alps-2024/map${search}`);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <SiteProvider value={site}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            <TripListProvider trips={[]}>
              <MapPageContent
                places={places}
                days={places.map((p) => ({ date: p.firstDate, slug: p.key, location: p.location,
                  country: p.country, countryCode: p.countryCode, hasPlace: true, mediaCount: 1 }))}
                stats={stats}
                over
                hasDays
                {...props}
              />
            </TripListProvider>
          </CurrencyProvider>
        </SiteProvider>
      </LocaleProvider>,
    );
  });
  return container!;
}

/** The map's own numbered marker for one stop — `aria-pressed` is
 * `StopMarker`'s own reflection of `WorldMap`'s selection, the one signal
 * that survives regardless of which width's CSS (`hidden lg:block` and
 * friends) a jsdom run never actually applies. */
function marker(el: HTMLElement, location: string): Element {
  const found = el.querySelector(`[aria-label="${location}, Switzerland"]`);
  if (!found) throw new Error(`no marker for ${location}`);
  return found;
}

describe("?day= on load", () => {
  test("selects the named day", () => {
    const el = render("?day=2024-09-02");
    expect(marker(el, "Susten").getAttribute("aria-pressed")).toBe("true");
    expect(marker(el, "Furka").getAttribute("aria-pressed")).toBe("false");
  });

  /**
   * The same case, mechanically, as a draft or hidden day's date: neither is
   * ever in `places` for a reader not allowed to see it, so this one test
   * covers both — see this file's own top comment.
   */
  test("an unknown date selects nothing", () => {
    const el = render("?day=2099-01-01");
    expect(marker(el, "Furka").getAttribute("aria-pressed")).toBe("false");
    expect(marker(el, "Susten").getAttribute("aria-pressed")).toBe("false");
  });

  test("without ?day= the whole trip is selected, with collapsed days and unmuted markers", () => {
    const el = render("");
    expect(marker(el, "Furka").getAttribute("aria-pressed")).toBe("false");
    expect(marker(el, "Susten").getAttribute("aria-pressed")).toBe("false");
    expect(el.querySelectorAll('section button[aria-expanded="false"]')).toHaveLength(2);
    expect(el.querySelector('section button[aria-expanded="true"]')).toBeNull();
    expect(el.querySelector('g[opacity="0.35"]')).toBeNull();
    expect(window.location.search).toBe("");
  });
});

describe("selecting a day", () => {
  test("replaces the URL with ?day=<date>, without adding a history entry", () => {
    const before = window.history.length;
    const el = render("");
    act(() => {
      marker(el, "Susten").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(marker(el, "Susten").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?day=2024-09-02");
    // `replaceState`, not `pushState` — Back still goes wherever Back went
    // before this tap, not to the previous selection.
    expect(window.history.length).toBe(before);
  });
});

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
function button(el: HTMLElement, text: string) {
  return [...el.querySelectorAll("button")].find((b) => b.textContent === text)!;
}

test("SVG marker repeat-click and Whole trip both clear selection and restore the camera", () => {
  const el = render("");
  const svg = el.querySelector('svg[role="group"]')!;
  const overview = svg.getAttribute("viewBox");
  click(marker(el, "Susten"));
  click(button(el, dictionaryFor("en")["map.thisStop"]));
  expect(svg.getAttribute("viewBox")).not.toBe(overview);
  click(button(el, dictionaryFor("en")["map.wholeTrip"]));
  expect(svg.getAttribute("viewBox")).toBe(overview);
  expect(window.location.search).toBe("");
  expect(marker(el, "Susten").getAttribute("aria-pressed")).toBe("false");
  click(marker(el, "Susten"));
  click(marker(el, "Susten"));
  expect(window.location.search).toBe("");
  expect(marker(el, "Susten").getAttribute("aria-pressed")).toBe("false");
});

test("desktop day buttons toggle selection and collapse again", () => {
  const el = render("");
  const day = el.querySelector('section button[aria-expanded]')!;
  click(day);
  expect(day.getAttribute("aria-expanded")).toBe("true");
  expect(window.location.search).toBe("?day=2024-09-01");
  click(day);
  expect(day.getAttribute("aria-expanded")).toBe("false");
  expect(window.location.search).toBe("");
  expect(marker(el, "Furka").getAttribute("aria-pressed")).toBe("false");
});

const streetMap = { url: "/test.pmtiles", bounds: [[0, 0], [20, 60]] as [[number, number], [number, number]] };

test.each(["", "?day=2024-09-01"])("street map fits overview and restores it after repeat-click (%s)", async (search) => {
  const far = place("far", "Far away", "2024-08-31", 1, 100);
  const el = render(search, { streetMap, places: [far, ...places], trackByDay: [
    { date: places[0].firstDate, points: [[46.57, 8.41], [46.58, 8.42]] },
  ] });
  await act(async () => {});
  const overview = [[8.4113, 46.5713], [8.4456, 46.7264]];
  const first = el.querySelector('[data-street-map] button[aria-label="Furka"]') as HTMLElement;
  const second = el.querySelector('[data-street-map] button[aria-label="Susten"]') as HTMLElement;
  expect(el.querySelector('[data-street-map] button[aria-label="Far away"]')).toBeNull();
  if (!search) {
    expect(street.fitBounds.mock.lastCall?.[0]).toEqual(overview);
    expect([first.style.opacity, second.style.opacity]).toEqual(["1", "1"]);
    click(first);
    await act(async () => {});
  }
  expect(window.location.search).toBe("?day=2024-09-01");
  expect(street.fitBounds.mock.lastCall?.[0]).not.toEqual(overview);
  expect(second.style.opacity).toBe("0.4");
  // Reuse the same DOM marker: its click handler must see current selection.
  click(first);
  await act(async () => {});
  expect(window.location.search).toBe("");
  expect(street.fitBounds.mock.lastCall?.[0]).toEqual(overview);
  expect([first.style.opacity, second.style.opacity]).toEqual(["1", "1"]);
  expect(el.textContent).toContain(dictionaryFor("en")["map.legend.recorded"]);
});

const plan = places.map((p) => ({ location: p.location, country: p.country,
  countryCode: p.countryCode, lat: p.lat, lng: p.lng, reached: false }));

test.each([
  { name: "finished, fully reached", over: true, hasDays: true, plan: plan.map((p) => ({ ...p, reached: true })), shown: false },
  { name: "finished, unreached stops", over: true, hasDays: true, plan, shown: false },
  { name: "not started", over: false, hasDays: false, plan, shown: true },
  { name: "under way", over: false, hasDays: true, plan: [{ ...plan[0], reached: true }, plan[1]], shown: true },
  { name: "no plan", over: false, hasDays: true, plan: [], shown: false },
  { name: "one stop, no leg", over: false, hasDays: false, plan: plan.slice(0, 1), shown: false },
  { name: "all stops reached", over: false, hasDays: true, plan: plan.map((p) => ({ ...p, reached: true })), shown: false },
])("planned legend: $name", ({ shown, ...props }) => {
  const el = render("", props);
  expect(el.textContent?.includes(dictionaryFor("en")["map.planned"])).toBe(shown);
  expect(el.textContent?.includes(dictionaryFor("en")["map.progress"])).toBe(shown);
});

test("street map has no planned legend because it draws no planned legs", async () => {
  const el = render("", { over: false, plan, streetMap });
  await act(async () => {});
  expect(el.textContent).not.toContain(dictionaryFor("en")["map.planned"]);
});

test("mobile list repeat-click clears the day and returns to the collapsed strip", () => {
  const el = render("");
  const sheet = el.querySelector("div.fixed.inset-x-0") as HTMLElement;
  const strip = sheet.querySelector('[role="list"]')!;
  click(strip.querySelector("button")!);
  expect(window.location.search).toBe("?day=2024-09-01");
  click(sheet.querySelector('button[aria-label="' + dictionaryFor("en")["map.everyDay"] + '"]')!);
  click(sheet.querySelector("ol button")!);
  expect(window.location.search).toBe("");
  expect(sheet.querySelector('[role="list"]')).not.toBeNull();
  expect(marker(el, "Furka").getAttribute("aria-pressed")).toBe("false");
});
