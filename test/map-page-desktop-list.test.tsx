// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import MapPageContent from "@/app/[user]/(trip)/map/MapPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { PlaceView } from "@/components/WorldMap";
import type { SiteSummary } from "@/lib/site";
import type { PlaceEntry } from "@/lib/types";

/**
 * The desktop map page's left-hand stop list (docs/plans/map-redesign.md §3
 * Phase 2 item 6, B2430) — the same "Every stop" list this page always drew,
 * now sharing the one lifted selection with the map next to it rather than
 * only linking out. Row click ↔ map selection is proven from `WorldMap`'s own
 * side in test/world-map-selection.test.tsx; this covers the list's own
 * contract: one row expands at a time, with only what the page was actually
 * handed for that stop, and nothing this list invents on its own.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/trips/parks-2025/map",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={(props.alt as string) ?? ""} src={props.src as string} />;
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

function place(overrides: Partial<PlaceView> & { entry?: Partial<PlaceEntry> } = {}): PlaceView {
  const { entry, ...rest } = overrides;
  return {
    key: "kyoto",
    location: "Kyoto",
    country: "Japan",
    countryCode: "JP",
    lat: 35.0116,
    lng: 135.7681,
    firstDate: "2027-04-08",
    lastDate: "2027-04-10",
    nights: 2,
    mediaCount: 1,
    entries: [
      {
        slug: "kyoto-in-april",
        date: "2027-04-08",
        location: "Kyoto",
        country: "Japan",
        countryCode: "JP",
        gallery: [{ src: "/media/kyoto-1.jpg", type: "image" }],
        headline: { en: "A quiet temple morning." },
        ...entry,
      } as PlaceEntry,
    ],
    ...rest,
  };
}

const stats = { tripDays: 3, places: 2, countries: 1, totalMedia: 2 };

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(places: PlaceView[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <SiteProvider value={site}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            <TripListProvider trips={[]}>
              <MapPageContent places={places} stats={stats} over hasDays />
            </TripListProvider>
          </CurrencyProvider>
        </SiteProvider>
      </LocaleProvider>,
    );
  });
  return container!;
}

function rows(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll<HTMLButtonElement>("ol button[aria-expanded]")];
}

describe("the desktop map page's stop list", () => {
  test("the first stop is expanded by default, showing only its own headline and photo", () => {
    const kyoto = place();
    const osaka = place({
      key: "osaka",
      location: "Osaka",
      firstDate: "2027-04-11",
      lastDate: "2027-04-11",
      entry: { slug: "osaka-day", headline: { en: "Street food night." }, gallery: [] },
    });
    const el = render([kyoto, osaka]);

    const [first, second] = rows(el);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(second.getAttribute("aria-expanded")).toBe("false");
    expect(el.textContent).toContain("A quiet temple morning.");
    expect(el.textContent).not.toContain("Street food night.");
    expect(el.querySelectorAll("img")).toHaveLength(1);
    expect(el.querySelector("img")!.getAttribute("src")).toBe("/media/kyoto-1.jpg");
  });

  test("clicking a row selects it: that row expands, the previous one collapses, and only its own content shows", () => {
    const kyoto = place();
    const osaka = place({
      key: "osaka",
      location: "Osaka",
      firstDate: "2027-04-11",
      lastDate: "2027-04-11",
      entry: { slug: "osaka-day", headline: { en: "Street food night." }, gallery: [] },
    });
    const el = render([kyoto, osaka]);

    act(() => rows(el)[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const [first, second] = rows(el);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(el.textContent).toContain("Street food night.");
    expect(el.textContent).not.toContain("A quiet temple morning.");
  });

  test("the expanded row links to the day and to Google Maps, at that stop's own coordinates", () => {
    const el = render([place()]);
    const links = [...el.querySelectorAll("a")];
    expect(links.some((a) => a.textContent?.includes(dictionaryFor("en")["map.readDay"]))).toBe(true);
    const gmaps = links.find((a) => a.getAttribute("href")?.includes("google.com/maps"));
    expect(gmaps).toBeTruthy();
    expect(gmaps!.getAttribute("href")).toContain("35.0116");
    expect(gmaps!.getAttribute("href")).toContain("135.7681");
  });

  test("a stop with no headline and no photos expands with neither, not a placeholder", () => {
    const bare = place({ entry: { headline: {}, gallery: [] } });
    const el = render([bare]);
    expect(el.querySelectorAll("img")).toHaveLength(0);
    // Nothing invented in its place.
    expect(el.textContent).not.toMatch(/no photos|coming soon/i);
  });
});
