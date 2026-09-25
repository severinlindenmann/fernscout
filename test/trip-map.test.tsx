// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import TripMap from "@/components/TripMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { frameRoute, kmForUnits, place } from "@/lib/mapFrame";
import { areaKey, googleMapsHref, tripStops, type StopSource } from "@/lib/tripMap";

/**
 * The trip's overview map — B1911.
 *
 * Three things this has to keep being true, and they are the three the old
 * `MiniMap` tests in `test/world-map.test.tsx` protected before this replaced
 * it: a marker is a mark on the map rather than larger than the map (B46), a
 * day with no coordinates never puts NaN through the frame (B265), and the
 * frame is the size of the trip rather than of a continent.
 *
 * On top of those, what is new here: which days become stops, where the view
 * starts, that selection survives a view change, and that the outbound link
 * points at the selected stop's own coordinates and nothing else.
 */

const alps: StopSource[] = [
  { date: "2024-06-01", location: "Grimsel", country: "Switzerland", countryCode: "CH", lat: 46.5606, lng: 8.3428 },
  { date: "2024-06-02", location: "Furka", country: "Switzerland", countryCode: "CH", lat: 46.5713, lng: 8.4113 },
  { date: "2024-06-03", location: "Susten", country: "Switzerland", countryCode: "CH", lat: 46.7264, lng: 8.4456 },
  { date: "2024-06-04", location: "Luzern", country: "Switzerland", countryCode: "CH", lat: 46.9214, lng: 8.4194 },
];

const noCoords = {
  date: "2024-06-05",
  location: "Somewhere",
  country: "Switzerland",
  lat: undefined as unknown as number,
  lng: undefined as unknown as number,
};

// jsdom has no ResizeObserver, and the map measures itself with one to size
// markers and labels in screen pixels rather than in viewBox units.
class StubResizeObserver {
  observe() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(days: StopSource[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <TripMap days={days} />
      </LocaleProvider>,
    );
  });
  return container!;
}

function html(): string {
  return container!.innerHTML;
}

function viewBox(): [number, number, number, number] {
  const box = container!.querySelector("svg")!.getAttribute("viewBox")!;
  return box.split(" ").map(Number) as [number, number, number, number];
}

function stopButtons(): HTMLButtonElement[] {
  // The name row under the map: every stop, reachable without a pointer on an
  // SVG. The view controls carry `aria-pressed` too, so they are excluded by
  // their own text rather than by position.
  const views = ["Whole trip", "Surroundings"];
  return Array.from(container!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).filter(
    (b) => !views.includes(b.textContent ?? ""),
  );
}

function control(label: string): HTMLButtonElement | undefined {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.getAttribute("aria-label") === label,
  );
}

function link(): HTMLAnchorElement {
  return container!.querySelector('a[href^="https://www.google.com/maps"]')!;
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("which days become stops", () => {
  test("a day with no coordinates is not a place, and puts no NaN on the map", () => {
    render([...alps, noCoords]);
    expect(html()).not.toContain("NaN");
    expect(stopButtons()).toHaveLength(alps.length);
  });

  test("consecutive days in one town are one stop, a return to it is another", () => {
    const stay = (date: string, location: string, lat: number, lng: number): StopSource => ({
      date,
      location,
      country: "Thailand",
      lat,
      lng,
    });
    const days = [
      stay("2025-01-01", "Bangkok", 13.7563, 100.5018),
      stay("2025-01-02", "Bangkok", 13.7566, 100.5021),
      stay("2025-01-03", "Chiang Mai", 18.7883, 98.9853),
      stay("2025-01-04", "Bangkok", 13.7563, 100.5018),
    ];
    expect(tripStops(days).map((s) => s.location)).toEqual(["Bangkok", "Chiang Mai", "Bangkok"]);
  });

  test("a trip where nothing is located draws nothing at all", () => {
    render([noCoords]);
    expect(html()).toBe("");
  });
});

describe("the frame it opens in", () => {
  test("several stops open on the whole trip, at the size of the trip", () => {
    render(alps);
    expect(kmForUnits(viewBox()[2])).toBeLessThan(250);
    expect(
      container!.querySelector('button[aria-pressed="true"]')!.textContent,
    ).toBe("Whole trip");
  });

  test("one stop opens on its surroundings, at town scale rather than on a building", () => {
    render([alps[0]]);
    expect(
      container!.querySelector('button[aria-pressed="true"]')!.textContent,
    ).toBe("Surroundings");
    // The 8 km floor in `mapFrame` is what stops a single coordinate framing
    // a doorway. Widened to the panel's shape, so it is the height that
    // carries the floor.
    expect(kmForUnits(viewBox()[3])).toBeGreaterThanOrEqual(8);
    expect(kmForUnits(viewBox()[2])).toBeLessThan(40);
  });

  test("markers are marks on the map, not larger than it", () => {
    render(alps);
    const w = viewBox()[2];
    const radii = [...html().matchAll(/\br="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) expect(r).toBeLessThan(w / 4);
  });

  test("a route across the antimeridian frames the short way round", () => {
    const pacific = [
      { lat: -36.85, lng: 174.76 },
      { lat: -18.14, lng: -178.44 },
    ];
    // 174.76 to -178.44 is 6.8° the short way and 353° the long way. Framed
    // the long way this was 39,000 km across with a stop on either edge; the
    // frame is now the trip, and `place` puts both stops inside it.
    const frame = frameRoute(pacific);
    expect(kmForUnits(frame.w)).toBeLessThan(8000);
    for (const point of pacific) {
      const [x, y] = place(frame, point);
      expect(x).toBeGreaterThanOrEqual(frame.x);
      expect(x).toBeLessThanOrEqual(frame.x + frame.w);
      expect(y).toBeGreaterThanOrEqual(frame.y);
      expect(y).toBeLessThanOrEqual(frame.y + frame.h);
    }
  });
});

describe("selection, and where it sends the reader", () => {
  test("the latest documented stop is selected, and says so", () => {
    render(alps);
    expect(container!.textContent).toContain("Last documented place");
    expect(link().getAttribute("href")).toBe(googleMapsHref(alps[3]));
  });

  test("choosing a stop moves the link to that stop's own coordinates", () => {
    render(alps);
    click(stopButtons()[0]);
    expect(container!.textContent).toContain("Selected place");
    const href = link().getAttribute("href")!;
    expect(new URL(href).searchParams.get("query")).toBe("46.5606,8.3428");
    expect(href).toContain("/maps/search/");
    expect(href).not.toContain("dir_action");
    expect(href).not.toContain("key=");
  });

  test("the selection survives switching views", () => {
    render(alps);
    click(stopButtons()[1]);
    const chosen = link().getAttribute("href");
    click(
      Array.from(container!.querySelectorAll("button")).find(
        (b) => b.textContent === "Surroundings",
      )!,
    );
    expect(link().getAttribute("href")).toBe(chosen);
    expect(container!.textContent).toContain(alps[1].location);
  });

  test("a southern, western coordinate is encoded as itself", () => {
    const href = googleMapsHref({ lat: -33.8688, lng: -151.2093 });
    expect(new URL(href).searchParams.get("query")).toBe("-33.8688,-151.2093");
    expect(href).toContain("query=-33.8688%2C-151.2093");
  });

  test("the link opens in a new tab, without handing the opener over", () => {
    render(alps);
    expect(link().getAttribute("target")).toBe("_blank");
    expect(link().getAttribute("rel")).toBe("noopener noreferrer");
    expect(link().getAttribute("aria-label")).toContain(alps[3].location);
  });
});

describe("what the reader is allowed to see", () => {
  /**
   * The component is handed the reader's own filtered summaries and derives
   * everything — frame, markers, names, the outbound link — from them. This is
   * that boundary written down: a day the caller withheld cannot appear in any
   * of the four.
   */
  test("a withheld day is in no frame, no name and no link", () => {
    const hidden: StopSource = {
      date: "2024-06-06",
      location: "Zermatt",
      country: "Switzerland",
      lat: 46.0207,
      lng: 7.7491,
    };
    render(alps);
    expect(container!.textContent).not.toContain("Zermatt");
    expect(link().getAttribute("href")).not.toContain("7.7491");
    const framed = viewBox();
    const [x, y] = [framed[0], framed[1]];
    const wide = frameRoute([...alps, hidden]);
    // Framed with the hidden stop the map would have had to reach 80 km south.
    expect(wide.w).toBeGreaterThan(framed[2]);
    expect(x + framed[2]).toBeLessThan(wide.x + wide.w + 1);
    expect(y).toBeGreaterThan(wide.y - 1);
  });

  test("areas are keyed coarsely enough that one town is one key", () => {
    expect(areaKey({ lat: 13.7563, lng: 100.5018 })).toBe(
      areaKey({ lat: 13.7566, lng: 100.5021 }),
    );
    expect(areaKey({ lat: 13.7563, lng: 100.5018 })).not.toBe(
      areaKey({ lat: 18.7883, lng: 98.9853 }),
    );
  });
});

describe("stepping through the stops", () => {
  /**
   * B1944. The chip row was 3,011 px of horizontal scrolling in a 356 px
   * window on an eighteen-stop trip; it is a list now, and these two arrows
   * are how it is walked without a pointer on an SVG.
   */
  test("the arrows move one stop at a time, in trip order", () => {
    render(alps);
    expect(container!.textContent).toContain("Stop 4 of 4");
    click(control("Previous stop")!);
    expect(container!.textContent).toContain("Stop 3 of 4");
    expect(link().getAttribute("href")).toBe(googleMapsHref(alps[2]));
    click(control("Next stop")!);
    expect(link().getAttribute("href")).toBe(googleMapsHref(alps[3]));
  });

  test("they stop at both ends rather than wrapping round", () => {
    render(alps);
    expect(control("Next stop")!.disabled).toBe(true);
    expect(control("Previous stop")!.disabled).toBe(false);
    for (let i = 0; i < 3; i++) click(control("Previous stop")!);
    expect(container!.textContent).toContain("Stop 1 of 4");
    expect(control("Previous stop")!.disabled).toBe(true);
  });

  test("the selected stop carries its country and the link, and nothing else does", () => {
    render(alps);
    // One outbound link on the card — the separate place panel that used to
    // name the same place again is gone.
    expect(container!.querySelectorAll('a[href^="https://www.google.com/maps"]')).toHaveLength(1);
    const open = link().closest("div")!;
    expect(open.textContent).toContain("Switzerland");
    expect(open.textContent).toContain("Stop 4 of 4");
  });

  test("reset is absent until the map has been moved", () => {
    render(alps);
    expect(control("Reset view")).toBeUndefined();
    click(control("Zoom in")!);
    expect(control("Reset view")).toBeDefined();
    click(control("Reset view")!);
    expect(control("Reset view")).toBeUndefined();
  });

  test("every stop is still a row, with its date", () => {
    render(alps);
    const rows = stopButtons();
    expect(rows).toHaveLength(alps.length);
    expect(rows[0].textContent).toContain("Grimsel");
    // The date a chip could not carry.
    expect(rows[0].textContent).toMatch(/\d/);
  });
});
