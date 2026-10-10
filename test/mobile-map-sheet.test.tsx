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
  days,
  initialDate,
  reportedDates,
  exposeSetter,
}: {
  places: PlaceView[];
  days: MapDay[];
  initialDate: string | null;
  reportedDates: (string | null)[];
  exposeSetter: (fn: (d: string | null) => void) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  exposeSetter(setSelectedDate);
  return (
    <MobileMapSheet
      days={days}
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

function render(
  places: PlaceView[],
  initialDate: string | null = places[0]?.firstDate ?? null,
  days: MapDay[] = daysFor(places),
) {
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
          days={days}
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
    expect(html).toContain(">Google Maps</a>"); // map.googleMapsShort, B2572
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

  describe("no selected day (B2634)", () => {
    test("the handle skips Half entirely — Peek goes straight to Full", () => {
      const { el } = render([place()], null);
      const h = handle(el);
      expect(el.textContent).not.toContain("Read this day"); // Peek
      act(() => h.click());
      expect(el.querySelector("ol")).not.toBeNull(); // Full, not Half
      expect(el.textContent).not.toContain("Read this day");
    });

    test("Full cycles straight back to Peek, never through an empty Half", () => {
      const { el } = render([place()], null);
      const h = handle(el);
      act(() => h.click()); // -> Full
      act(() => h.click()); // -> Peek
      expect(el.querySelector("ol")).toBeNull();
      expect(el.textContent).not.toContain("Read this day");
    });

    test("a placeless day with no gallery and no headline still has a title and a read button, not a blank panel", () => {
      const days: MapDay[] = [
        {
          date: "2024-05-01",
          slug: "2024-05-01-untitled",
          location: "",
          country: "",
          lat: NaN,
          lng: NaN,
          hasPlace: false,
          mediaCount: 0,
          updates: 1,
        },
      ];
      const { el } = render([], "2024-05-01", days);
      act(() => handle(el).click()); // -> Half (reachable: a day IS selected)
      expect(el.textContent).toContain("No place given"); // map.noPlaceGiven
      expect(el.textContent).toContain("Read this day");
    });

    test("a hidden place reads as withheld, not as no place given", () => {
      const days: MapDay[] = [
        {
          date: "2024-05-01",
          slug: "2024-05-01-hidden",
          location: "A secret valley",
          country: "Alphaland",
          lat: NaN,
          lng: NaN,
          hasPlace: false,
          hidden: true,
          mediaCount: 0,
          updates: 1,
        },
      ];
      const { el } = render([], "2024-05-01", days);
      act(() => handle(el).click());
      expect(el.textContent).toContain("Place kept private"); // map.placeHidden
      expect(el.textContent).not.toContain("No place given");
    });
  });

  describe("the selected day's own entry, not always the place's first (B2634)", () => {
    test("a two-day stay at one place shows the second day's own headline, photos and read link", () => {
      const stay = place({
        key: "alpha",
        firstDate: "2024-05-01",
        lastDate: "2024-05-02",
        entries: [
          {
            slug: "2024-05-01-alpha",
            date: "2024-05-01",
            location: "Alpha Town",
            country: "Alphaland",
            gallery: [{ src: "/media/day1.jpg", type: "image" }],
            headline: { en: "Arriving in Alpha Town." },
          },
          {
            slug: "2024-05-02-alpha",
            date: "2024-05-02",
            location: "Alpha Town",
            country: "Alphaland",
            gallery: [{ src: "/media/day2.jpg", type: "image" }],
            headline: { en: "A second day here." },
          },
        ],
      });
      const days: MapDay[] = [
        {
          date: "2024-05-01",
          slug: "2024-05-01-alpha",
          location: "Alpha Town",
          country: "Alphaland",
          countryCode: "al",
          lat: 1,
          lng: 2,
          hasPlace: true,
          mediaCount: 1,
          updates: 1,
        },
        {
          date: "2024-05-02",
          slug: "2024-05-02-alpha",
          location: "Alpha Town",
          country: "Alphaland",
          countryCode: "al",
          lat: 1,
          lng: 2,
          hasPlace: true,
          mediaCount: 1,
          updates: 1,
        },
      ];
      const { el } = render([stay], "2024-05-02", days);
      act(() => handle(el).click()); // -> Half, on the second day

      expect(el.textContent).toContain("A second day here.");
      expect(el.textContent).not.toContain("Arriving in Alpha Town.");

      const img = el.querySelector("img")!;
      expect(img.getAttribute("src")).toBe("/media/day2.jpg");

      const readLink = Array.from(el.querySelectorAll("a")).find((a) =>
        a.textContent?.includes("Read this day"),
      )!;
      expect(readLink.getAttribute("href")).toBe("/day/2024-05-02-alpha");
    });
  });

  describe("tapping a photo in the sheet opens it full screen (B2635)", () => {
    test("a thumbnail is a real button, and tapping it opens the Lightbox on that photo", async () => {
      const withPhoto = place({
        entries: [
          {
            slug: "2024-05-01-alpha",
            date: "2024-05-01",
            location: "Alpha Town",
            country: "Alphaland",
            gallery: [{ src: "/media/a.jpg", type: "image", caption: "A quiet lake" }],
            headline: {},
          },
        ],
      });
      const { el } = render([withPhoto]);
      act(() => handle(el).click()); // -> Half

      const thumb = el.querySelector<HTMLButtonElement>('button[aria-label="A quiet lake"]')!;
      expect(thumb.tagName).toBe("BUTTON"); // not an inert <span>

      // Not open yet: the Lightbox portal renders nothing until tapped.
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();

      act(() => thumb.click());

      const dialog = document.body.querySelector('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/media/a.jpg");

      const closeButton = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
      await act(async () => {
        closeButton.click();
        // `AnimatePresence`'s exit is a real animation; give it a tick
        // rather than asserting the DOM gone the instant `onClose` fires.
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      // Closing the viewer leaves the sheet itself exactly where it was.
      expect(el.textContent).toContain("Read this day");
    });
  });

  test("B2650: the reported inset includes the wrapper's safe-area padding", () => {
    const real = window.getComputedStyle;
    const width = window.innerWidth;
    window.innerWidth = 390; // jsdom defaults to 1024 = desktop, where the inset is 0
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((el, pseudo) =>
        el instanceof HTMLElement && el.className.includes("fixed inset-x-0")
          ? ({ paddingBottom: "34px" } as CSSStyleDeclaration)
          : real(el, pseudo),
      );
    const insets: number[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const p = place();
    act(() => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <MobileMapSheet
            days={daysFor([p])}
            places={[p]}
            hrefForDay={(s) => `/day/${s}`}
            selectedDate={null}
            onSelectDate={() => {}}
            onInsetChange={(px) => insets.push(px)}
          />
        </LocaleProvider>,
      );
    });
    spy.mockRestore();
    window.innerWidth = width;
    expect(insets.at(-1)).toBe(118 + 34); // PEEK_PX + safe area
  });
});
