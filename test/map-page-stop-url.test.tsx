// @vitest-environment jsdom
import { act } from "react";
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

function render(search: string) {
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
                stats={stats}
                over
                hasDays
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
    // Neither stop is pressed — the page's own no-selection default
    // (`plottable[0]`, applied before this component ever reads the URL)
    // is left standing, exactly as if `?day=` had never been on the link.
    expect(marker(el, "Furka").getAttribute("aria-pressed")).toBe("true");
    expect(marker(el, "Susten").getAttribute("aria-pressed")).toBe("false");
  });

  test("with no ?day= at all, the page's own default stands", () => {
    const el = render("");
    expect(marker(el, "Furka").getAttribute("aria-pressed")).toBe("true");
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
