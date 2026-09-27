// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { PlaceEntry } from "@/lib/types";

/**
 * `WorldMap`'s selection, made controllable for B2427's map-page review: a
 * `selectedKey` nudge from outside (the mobile sheet, the sheet's own time
 * scrubber copy) is applied through the same `selectPlace` a marker tap
 * calls, and every change — from either source — is reported through
 * `onSelect`. Both props are optional so the countdown and the studio's
 * recorded-trips preview, which pass neither, keep the map's own internal,
 * self-contained selection exactly as before.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

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
    entries: [{ slug: key, date: "2024-09-12", location, country: "Switzerland", gallery: [], headline: {} } as PlaceEntry],
  };
}

const places = [
  stop("a", "Domodossola", 46.1161, 8.2939),
  stop("b", "Grimsel", 46.5614, 8.3372),
];

// jsdom has no ResizeObserver, and the map measures itself with one — same
// stub as test/trip-map.test.tsx.
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

function render(props: Partial<React.ComponentProps<typeof WorldMap>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <WorldMap places={places} {...props} />
      </LocaleProvider>,
    );
  });
  return container!;
}

function markerFor(root: HTMLElement, ariaLabel: string): SVGGElement {
  return [...root.querySelectorAll<SVGGElement>('g[role="button"]')].find(
    (g) => g.getAttribute("aria-label") === ariaLabel,
  )!;
}

describe("WorldMap selection", () => {
  test("with no selectedKey/onSelect (the countdown, the studio preview), a tap still selects locally", () => {
    const el = render();
    const marker = markerFor(el, "Domodossola, Switzerland");
    expect(marker.getAttribute("aria-pressed")).toBe("false");
    act(() => marker.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(markerFor(el, "Domodossola, Switzerland").getAttribute("aria-pressed")).toBe("true");
  });

  test("tapping a marker reports the selection through onSelect", () => {
    const seen: (string | null)[] = [];
    const el = render({ onSelect: (p) => seen.push(p ? p.key : null) });
    const marker = markerFor(el, "Grimsel, Switzerland");
    act(() => marker.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(seen).toEqual(["b"]);
  });

  test("the selected-stop card shows everywhere by default, and only from lg up when the page's own sheet shows the stop", () => {
    const card = (el: HTMLElement) => el.querySelector<HTMLElement>("div.backdrop-blur.shadow-lg");
    const plain = render({ selectedKey: "b" });
    expect(card(plain)?.className).not.toContain("hidden");
    act(() => root!.unmount());
    container!.remove();
    const paged = render({ selectedKey: "b", stopCardFromLg: true });
    expect(card(paged)?.className).toContain("hidden lg:block");
  });

  test("an outside selectedKey nudges the same marker selected, as if it had been tapped", () => {
    const el = render({ selectedKey: "b" });
    expect(markerFor(el, "Grimsel, Switzerland").getAttribute("aria-pressed")).toBe("true");
    expect(markerFor(el, "Domodossola, Switzerland").getAttribute("aria-pressed")).toBe("false");
  });

  test("selectedKey: null clears the selection", () => {
    function Harness({ selectedKey }: { selectedKey: string | null }) {
      return <WorldMap places={places} selectedKey={selectedKey} />;
    }
    act(() => {
      root = createRoot((container = document.body.appendChild(document.createElement("div"))));
      root.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <Harness selectedKey="a" />
        </LocaleProvider>,
      );
    });
    expect(markerFor(container!, "Domodossola, Switzerland").getAttribute("aria-pressed")).toBe("true");
    act(() => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <Harness selectedKey={null} />
        </LocaleProvider>,
      );
    });
    expect(markerFor(container!, "Domodossola, Switzerland").getAttribute("aria-pressed")).toBe("false");
  });
});
