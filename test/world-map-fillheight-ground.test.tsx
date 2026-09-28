// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import WorldMap, { type PlaceView } from "@/components/WorldMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import worldLand from "@/lib/worldLand.json";
import type { Basemap } from "@/lib/basemap";
import type { PlaceEntry } from "@/lib/types";

/**
 * B2426, the follow-up. The full-screen map on a phone (`fillHeight`) grows
 * its own viewBox taller than the basemap's own clip — still framed to the
 * page's landscape `TARGET_ASPECT` (lib/mapFrame.ts) — so the margin above
 * and below drew as blank sea (found live on `alps-2024` at 390px). Padding
 * the clip itself measured 1.4–2.7x the basemap payload on the example
 * journal (alps-2024, parks-2025), so the fix instead reuses the coarse
 * 1:110m coastline every page already loads as the no-basemap fallback,
 * drawn underneath the detailed basemap rather than replacing it.
 *
 * `renderToStaticMarkup`, used everywhere else in test/world-map.test.tsx,
 * never runs effects — `useWorldLand`'s dynamic import would never resolve,
 * so this is the one WorldMap test that mounts for real.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// A portrait box (width < height) — jsdom never actually lays anything out,
// so without this the SVG's own `drawn` state keeps its landscape default
// forever, and `view` never grows past `base` the way a real phone's
// `fillHeight` box does. Real `ResizeObserver` callbacks fire async (after
// layout); calling it inline is close enough for what this file asserts.
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

const place: PlaceView = {
  key: "andermatt",
  location: "Andermatt",
  country: "Switzerland",
  countryCode: "CH",
  lat: 46.6364,
  lng: 8.5942,
  firstDate: "2024-09-15",
  lastDate: "2024-09-15",
  nights: 1,
  mediaCount: 1,
  entries: [{ slug: "andermatt", date: "2024-09-15", gallery: [] } as unknown as PlaceEntry],
};

const basemap: Basemap = {
  borders: ["M0,0 L1,1"],
  admin1: [],
  relief: [],
  glaciers: [],
  parks: [],
  railroads: [],
  roads: [],
  lakes: [],
  rivers: [],
  peaks: [],
  towns: [],
  attribution: "",
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

/** The world outline's own paths, once `useWorldLand`'s dynamic import has
 * resolved — real content (`lib/worldLand.json`), not a fixture. */
async function renderAndWaitForWorldLand(fillHeight: boolean) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <WorldMap places={[place]} basemap={basemap} fillHeight={fillHeight} />
      </LocaleProvider>,
    );
    // Flushes the microtask `useWorldLand`'s cached/inflight promise resolves
    // on, and the state update it schedules.
    await Promise.resolve();
    await Promise.resolve();
  });
  return container!;
}

const susten: PlaceView = {
  key: "susten",
  location: "Susten Pass",
  country: "Switzerland",
  countryCode: "CH",
  lat: 46.7297,
  lng: 8.4444,
  firstDate: "2024-09-12",
  lastDate: "2024-09-12",
  nights: 1,
  mediaCount: 1,
  entries: [{ slug: "susten", date: "2024-09-12", gallery: [] } as unknown as PlaceEntry],
};

describe("selecting a different stop, with fillHeight (B2426 follow-up)", () => {
  /**
   * Found live: clicking a different stop's marker while already on the
   * full-screen map page could paint a huge, wrongly-shaped dome. One
   * hypothesis was a `px()`/scale race on the *selected marker itself* —
   * its radius computed from a stale or near-zero measurement right after
   * the selection changes the camera. Instrumented rather than reasoned
   * about: the marker's own `r` is asserted directly, immediately after
   * each of three consecutive selection changes, the same repro (clicking
   * another stop's marker three times in a row) that showed the dome live.
   * (The dome itself turned out to be a separate basemap-clip issue, fixed
   * above and by `stripClipEdges` — this test stands as the regression
   * guard for the hypothesis this ticket's own coordinator raised.)
   */
  test("the selected marker's radius stays normal through three consecutive selections", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const places = [susten, place];
    let selectedKey: string | null = susten.key;
    const render = () =>
      act(() => {
        root!.render(
          <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
            <WorldMap
              places={places}
              basemap={basemap}
              fillHeight
              selectedKey={selectedKey}
              onSelect={() => {}}
            />
          </LocaleProvider>,
        );
      });
    render();
    await act(async () => {
      await Promise.resolve();
    });

    const order = [place.key, susten.key, place.key];
    for (const key of order) {
      selectedKey = key;
      render();
      const svg = container.querySelector('svg[role="group"]')!;
      const view = svg.getAttribute("viewBox")!.split(" ").map(Number);
      const selectedCircle = svg.querySelector('circle[fill="var(--map-selected-fill)"]');
      expect(selectedCircle).not.toBeNull();
      const r = Number(selectedCircle!.getAttribute("r"));
      // A marker radius is a small fraction of the frame it's drawn in,
      // never a wild multiple of it — the shape a stale-scale race would
      // produce. view[2] is the frame's own width.
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(view[2] * 0.1);
    }
  });
});

describe("the ground fillHeight draws under a clipped basemap", () => {
  test("without fillHeight, only the basemap's own paths are drawn", async () => {
    const el = await renderAndWaitForWorldLand(false);
    const paths = el.querySelector('svg[role="group"]')!.querySelectorAll("path");
    // Exactly the one border path this fixture's basemap carries — the
    // world outline never joins it.
    expect(paths.length).toBe(basemap.borders.length);
  });

  test("with fillHeight, the world outline is drawn underneath as well", async () => {
    const el = await renderAndWaitForWorldLand(true);
    const svg = el.querySelector('svg[role="group"]')!;
    const paths = svg.querySelectorAll("path");
    // The world outline's own paths — once for the margin above `base`,
    // once for the margin below it (the stub's portrait box means both
    // exist) — plus the basemap's own border.
    expect(paths.length).toBe(worldLand.length * 2 + basemap.borders.length);
    // Both windowed to a nested <svg> (a rectangle's own native, reliable
    // clip — B2426 follow-up's own doc on why not a CSS clip-path), not
    // free-floating over the whole view.
    expect(svg.querySelectorAll("svg").length).toBeGreaterThanOrEqual(3);
  });
});
