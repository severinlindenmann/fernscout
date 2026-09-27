// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import MobileMapSheet from "@/components/map/MobileMapSheet";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { PlaceView } from "@/components/WorldMap";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={(props.alt as string) ?? ""} src={props.src as string} />;
  },
}));

/**
 * The map page's own three-snap sheet (B2427), built on `useSnapDrag` — see
 * test/snap-sheet.test.tsx for the shared drag logic itself. This covers the
 * sheet's own contract: keyboard cycling, the half snap's height budget (the
 * plan's "the map keeps at least 55% of the screen" — this sheet's own half
 * of that bargain is never asking for more than 45%), and that half shows
 * only what the page actually handed it, nothing invented.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function place(overrides: Partial<PlaceView> = {}): PlaceView {
  return {
    key: "alpha",
    location: "Alpha Town",
    country: "Alphaland",
    countryCode: "al",
    lat: 1,
    lng: 2,
    firstDate: "2024-05-01",
    lastDate: "2024-05-02",
    nights: 1,
    mediaCount: 0,
    entries: [
      {
        slug: "2024-05-01-alpha",
        date: "2024-05-01",
        location: "Alpha Town",
        country: "Alphaland",
        countryCode: "al",
        gallery: [],
        headline: {},
      },
    ],
    ...overrides,
  };
}

function render(places: PlaceView[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <MobileMapSheet
          places={places}
          stats={{ tripDays: 3, places: places.length, countries: 1, totalMedia: 0 }}
          hrefForDay={(slug) => `/day/${slug}`}
        />
      </LocaleProvider>,
    );
  });
  return container!;
}

function handle(root: HTMLElement): HTMLButtonElement {
  // The first button in the sheet is always the drag handle.
  return root.querySelector("button")!;
}

describe("MobileMapSheet", () => {
  test("renders nothing when the trip has no places", () => {
    const el = render([]);
    expect(el.querySelector("button")).toBeNull();
  });

  test("starts at peek, showing the stats and nothing about a stop", () => {
    const el = render([place()]);
    expect(el.textContent).toContain("3"); // tripDays
    expect(el.textContent).not.toContain("Alpha Town");
  });

  test("clicking the handle cycles peek → half → full → peek", () => {
    const el = render([place(), place({ key: "beta", location: "Beta City" })]);
    const h = handle(el);
    expect(el.textContent).not.toContain("Alpha Town");

    act(() => h.click());
    expect(el.textContent).toContain("Alpha Town"); // half: the selected stop

    act(() => h.click());
    expect(el.textContent).toContain("Beta City"); // full: every stop

    act(() => h.click());
    expect(el.textContent).not.toContain("Alpha Town");
    expect(el.textContent).not.toContain("Beta City");
  });

  test("Escape returns to peek from any snap", () => {
    const el = render([place()]);
    const h = handle(el);
    act(() => h.click()); // -> half
    expect(el.textContent).toContain("Alpha Town");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(el.textContent).not.toContain("Alpha Town");
  });

  test("half shows only the fields the page actually gave it — no invented text", () => {
    // No headline, no gallery — the fixture's defaults. Half must not
    // fabricate an opening line or photos that were never there.
    const el = render([place()]);
    act(() => handle(el).click());
    const html = el.innerHTML;
    expect(html).toContain("Alpha Town");
    expect(html).toContain("Read this day"); // map.readDay
    expect(html).toContain("Open in Google Maps"); // tripMap.googleMaps
    expect(el.querySelectorAll("img, video").length).toBe(0);
    expect(el.querySelector("p")).toBeNull(); // the headline paragraph
  });

  test("half shows the day's real headline and photos when the page has them", () => {
    const withContent = place({
      entries: [
        {
          slug: "2024-05-01-alpha",
          date: "2024-05-01",
          location: "Alpha Town",
          country: "Alphaland",
          gallery: [{ src: "/media/a.jpg", type: "image" }],
          headline: { en: "A quiet morning by the lake." },
        },
      ],
    });
    const el = render([withContent]);
    act(() => handle(el).click());
    expect(el.textContent).toContain("A quiet morning by the lake.");
    expect(el.querySelectorAll("img").length).toBe(1);
  });

  test("half's height never exceeds 45% of the viewport", () => {
    const el = render([place()]);
    act(() => handle(el).click());
    const panel = el.querySelector<HTMLDivElement>(".flex.flex-col.overflow-hidden")!;
    const px = parseFloat(panel.style.height);
    expect(px).toBeGreaterThan(0);
    expect(px).toBeLessThanOrEqual(0.45 * window.innerHeight);
  });
});
