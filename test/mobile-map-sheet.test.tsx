// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import MobileMapSheet from "@/components/map/MobileMapSheet";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { PlaceView } from "@/components/WorldMap";
import type { MapDay } from "@/lib/map/mapDays";

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
 * of that bargain is never asking for more than 45%), that half shows only
 * what the page actually handed it, and — after the review — that its
 * selection is a controlled prop: it reports what it picks through
 * `onSelectKey` rather than owning its own notion of the current stop, and a
 * selection arriving from outside (a marker tap, in the real page) opens it
 * to Half.
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

/** The day list `MapPageContent` would derive from these places (B2537) —
 * one calendar day per place, all located, since none of these tests exercise
 * the "no place given" row (that is `map-page.test.tsx`'s own job). */
function daysFor(places: PlaceView[]): MapDay[] {
  return places.map((p) => ({
    date: p.firstDate,
    slug: p.entries[0].slug,
    location: p.location,
    country: p.country,
    countryCode: p.countryCode,
    lat: p.lat,
    lng: p.lng,
    hasPlace: true,
    mediaCount: p.mediaCount,
    updates: p.entries.length,
  }));
}

/**
 * Stands in for `MapPageContent`, which owns the one selection the real page
 * shares with `WorldMap` — a plain `useState` here proves the sheet holds no
 * selection of its own. `reportedDates` records every `onSelectDate` call, so
 * a test can tell the sheet actually asked to change the selection rather
 * than only having changed what it shows locally.
 */
function Harness({
  places,
  initialDate,
  reportedDates,
  exposeSetter,
}: {
  places: PlaceView[];
  initialDate: string | null;
  reportedDates: (string | null)[];
  exposeSetter: (fn: (d: string | null) => void) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  exposeSetter(setSelectedDate);
  return (
    <MobileMapSheet
      days={daysFor(places)}
      places={places}
      hrefForDay={(slug) => `/day/${slug}`}
      selectedDate={selectedDate}
      onSelectDate={(d) => {
        reportedDates.push(d);
        setSelectedDate(d);
      }}
    />
  );
}

function render(places: PlaceView[], initialDate: string | null = places[0]?.firstDate ?? null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const reportedDates: (string | null)[] = [];
  let setFromOutside: (d: string | null) => void = () => {};
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <Harness
          places={places}
          initialDate={initialDate}
          reportedDates={reportedDates}
          exposeSetter={(fn) => {
            setFromOutside = fn;
          }}
        />
      </LocaleProvider>,
    );
  });
  return {
    el: container!,
    reportedKeys: reportedDates,
    setKeyFromOutside: (d: string | null) => act(() => setFromOutside(d)),
  };
}

function handle(root: HTMLElement): HTMLButtonElement {
  // The first button in the sheet is always the drag handle.
  return root.querySelector("button")!;
}

describe("MobileMapSheet", () => {
  test("renders nothing when the trip has no days", () => {
    const { el } = render([], null);
    expect(el.querySelector("button")).toBeNull();
  });

  test("starts at peek, showing the day strip and no stat tiles or day detail", () => {
    const { el } = render([place()]);
    expect(el.textContent).toContain("Alpha Town"); // the day strip's own row
    expect(el.textContent).not.toContain("Read this day"); // map.readDay — half only
  });

  test("clicking the handle cycles peek → half → full → peek", () => {
    const { el } = render([
      place(),
      place({ key: "beta", location: "Beta City", firstDate: "2024-05-03", lastDate: "2024-05-03" }),
    ]);
    const h = handle(el);
    expect(el.textContent).not.toContain("Read this day");
    expect(el.querySelector("ol")).toBeNull();

    act(() => h.click());
    expect(el.textContent).toContain("Read this day"); // half: the selected day's own detail

    act(() => h.click());
    expect(el.querySelector("ol")).not.toBeNull(); // full: every day, as a list

    act(() => h.click());
    expect(el.textContent).not.toContain("Read this day");
    expect(el.querySelector("ol")).toBeNull();
  });

  test("Escape returns to peek from any snap", () => {
    const { el } = render([place()]);
    const h = handle(el);
    act(() => h.click()); // -> half
    expect(el.textContent).toContain("Read this day");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(el.textContent).not.toContain("Read this day");
  });

  test("half shows only the fields the page actually gave it — no invented text", () => {
    // No headline, no gallery — the fixture's defaults. Half must not
    // fabricate an opening line or photos that were never there.
    const { el } = render([place()]);
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
    const { el } = render([withContent]);
    act(() => handle(el).click());
    expect(el.textContent).toContain("A quiet morning by the lake.");
    expect(el.querySelectorAll("img").length).toBe(1);
  });

  test("half's height never exceeds 45% of the viewport", () => {
    const { el } = render([place()]);
    act(() => handle(el).click());
    const panel = el.querySelector<HTMLDivElement>(".flex.flex-col.overflow-hidden")!;
    const px = parseFloat(panel.style.height);
    expect(px).toBeGreaterThan(0);
    expect(px).toBeLessThanOrEqual(0.45 * window.innerHeight);
  });

  describe("one selection, shared with the map (the review after B2427's first pass)", () => {
    test("tapping a stop in Full reports it through onSelectDate, not just locally", () => {
      const beta = place({ key: "beta", location: "Beta City", firstDate: "2024-05-03", lastDate: "2024-05-03" });
      const { el, reportedKeys } = render([place(), beta]);
      act(() => handle(el).click()); // -> half
      act(() => handle(el).click()); // -> full
      const rows = el.querySelectorAll<HTMLButtonElement>("ol button");
      act(() => rows[1].click()); // Beta City
      expect(reportedKeys).toContain("2024-05-03");
      expect(el.textContent).toContain("Beta City"); // jumped to half showing it
    });

    test("previous/next report the new key the same way", () => {
      const { el, reportedKeys } = render([
        place(),
        place({ key: "beta", location: "Beta City", firstDate: "2024-05-03", lastDate: "2024-05-03" }),
      ]);
      act(() => handle(el).click()); // -> half, on alpha
      const next = el.querySelector<HTMLButtonElement>('[aria-label="Next stop"]')!;
      act(() => next.click());
      expect(reportedKeys).toContain("2024-05-03");
    });

    test("a selection arriving from outside (a marker tapped on the map) opens Half", () => {
      const { el, setKeyFromOutside } = render([
        place(),
        place({ key: "beta", location: "Beta City", firstDate: "2024-05-03", lastDate: "2024-05-03" }),
      ]);
      expect(el.textContent).not.toContain("Read this day"); // still at peek
      setKeyFromOutside("2024-05-03");
      expect(el.textContent).toContain("Read this day"); // Half opened by itself
    });

    test("the initial default selection does not itself pop the sheet open", () => {
      const { el } = render([place()], "2024-05-01");
      // Same date the sheet started with — no external tap has happened.
      expect(el.textContent).not.toContain("Read this day");
    });
  });
});
