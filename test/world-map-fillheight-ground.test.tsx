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

class StubResizeObserver {
  observe() {}
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
  entries: [{ slug: "andermatt", date: "2024-09-15" } as unknown as PlaceEntry],
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
    const paths = el.querySelector('svg[role="group"]')!.querySelectorAll("path");
    expect(paths.length).toBe(basemap.borders.length + worldLand.length);
  });
});
