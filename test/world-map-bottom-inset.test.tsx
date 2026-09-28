// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { PlaceEntry } from "@/lib/types";

/**
 * B2517: at 390px, with the mobile sheet at Half, "Whole trip" framed the
 * *full* map height (`fillHeight`'s own viewport-sized box) and ignored the
 * part the sheet covers — a stop framed into that hidden band never showed
 * on screen. `bottomInset` (CSS px, reported by `MobileMapSheet` through
 * `MapPageContent`) makes both "Whole trip" and "This stop" frame into the
 * part of the box *above* the sheet instead. Desktop and every other caller
 * pass none, so `bottomInset` defaults to 0 and both behave exactly as
 * before (asserted directly below).
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// A tall (portrait-phone-shaped) box, matching how `fillHeight` actually
// draws below `lg` — same stub as test/world-map-fillheight-ground.test.tsx.
class StubResizeObserver {
  #cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.#cb = cb;
  }
  observe(target: Element) {
    this.#cb(
      [{ target, contentRect: { width: 390, height: 780 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

function stop(key: string, location: string, lat: number, lng: number): PlaceView {
  return {
    key,
    location,
    country: "Switzerland",
    countryCode: "CH",
    lat,
    lng,
    firstDate: "2024-09-12",
    lastDate: "2024-09-12",
    nights: 1,
    mediaCount: 0,
    entries: [
      { slug: key, date: "2024-09-12", location, country: "Switzerland", gallery: [], headline: {} } as PlaceEntry,
    ],
  };
}

// Spread across the Alps, the real shape of `alps-2024`'s own regression —
// Domodossola, the stop the ticket names, is the southernmost (largest lat)
// and would be the one framed lowest, closest to the sheet.
const places = [
  stop("grimsel", "Grimsel", 46.5614, 8.3372),
  stop("andermatt", "Andermatt", 46.6364, 8.5942),
  stop("domodossola", "Domodossola", 46.1161, 8.2939),
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(props: Partial<React.ComponentProps<typeof WorldMap>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <WorldMap places={places} fillHeight {...props} />
      </LocaleProvider>,
    );
  });
  return container!;
}

function viewBoxOf(el: HTMLElement): { x: number; y: number; w: number; h: number } {
  const svg = el.querySelector('svg[role="group"]')!;
  const [x, y, w, h] = svg.getAttribute("viewBox")!.split(" ").map(Number);
  return { x, y, w, h };
}

function markerFor(el: HTMLElement, ariaLabel: string): SVGGElement {
  return [...el.querySelectorAll<SVGGElement>('g[role="button"]')].find(
    (g) => g.getAttribute("aria-label") === ariaLabel,
  )!;
}

function circleCy(g: SVGGElement): number {
  return Number(g.querySelector("circle")!.getAttribute("cy"));
}

describe("WorldMap bottom inset (B2517)", () => {
  test("with no inset, the visible window is the whole viewBox (unchanged desktop/default behaviour)", () => {
    const el = render();
    const { y, h } = viewBoxOf(el);
    for (const place of places) {
      const cy = circleCy(markerFor(el, `${place.location}, Switzerland`));
      expect(cy).toBeGreaterThanOrEqual(y);
      expect(cy).toBeLessThanOrEqual(y + h);
    }
  });

  test("Whole trip: every stop lands above a 300px sheet, not just inside the full viewBox", () => {
    const el = render({ bottomInset: 300 });
    const { y, h } = viewBoxOf(el);
    // The visible window is the *top* fraction of the viewBox — the same
    // fraction `MobileMapSheet`'s own inset covers of the 780px stub box.
    const visibleFrac = 1 - 300 / 780;
    const visibleBottom = y + h * visibleFrac;
    for (const place of places) {
      const cy = circleCy(markerFor(el, `${place.location}, Switzerland`));
      expect(cy).toBeGreaterThanOrEqual(y);
      // The regression: Domodossola landed below this line, inside the band
      // the sheet was actually covering.
      expect(cy).toBeLessThanOrEqual(visibleBottom);
    }
  });

  test("This stop: the selected marker centres in the visible window above the sheet, not the full box", () => {
    const el = render({ bottomInset: 300, selectedKey: "domodossola" });
    // "This stop" — `StopScopeSwitch`'s second button, shown once a stop is
    // selected.
    const stopButton = [...el.querySelectorAll("button")].find((b) => b.textContent === "This stop")!;
    act(() => stopButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const { y, h } = viewBoxOf(el);
    const visibleFrac = 1 - 300 / 780;
    const visH = h * visibleFrac;
    const cy = circleCy(markerFor(el, "Domodossola, Switzerland"));
    // Centred in the visible band above the sheet (y .. y + visH), not in
    // the full viewBox (y .. y + h), which is what the bug centred it in.
    expect(cy).toBeCloseTo(y + visH / 2, 5);
  });

  test("an inset near the full box height still produces a sane, non-inverted frame", () => {
    // 700 of 780 — Full snap, close to the whole box. The clamp in
    // `WorldMap`'s own `view` keeps `visibleFrac` from collapsing to (or
    // past) zero, which would otherwise divide by zero or invert the frame.
    // (At this extreme the three stops merge into one cluster marker —
    // asserted separately above at the sizes the ticket actually names —
    // so this only checks the viewBox itself stays finite and right-side up.)
    const el = render({ bottomInset: 700 });
    const { w, h } = viewBoxOf(el);
    expect(Number.isFinite(w)).toBe(true);
    expect(Number.isFinite(h)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });
});
