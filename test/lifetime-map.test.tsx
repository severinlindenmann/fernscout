// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LifetimeMap, { type CountryVisit } from "@/components/LifetimeMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import countries from "@/lib/worldCountries.json";

/**
 * B2491 rewrite. B2423's own interaction tests (route/marker sizing,
 * decluttering, screen-pixel markers) no longer describe anything that
 * exists — decision 1 removed every route, marker and per-trip legend from
 * this map. What replaces them: pin/unpin by click and by keyboard, hover
 * gated on `(hover: hover)`, and reduced motion skipping the glide/Einstieg
 * entirely (Gotchas — headless/backgrounded rAF never fires either, so
 * these tests never assert a mid-tween frame, only the instant and the
 * settled end state).
 */

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function shapeOf(code: string) {
  const c = (countries as { code: string | null; name: string; path: string; x: number }[]).find(
    (x) => x.code === code,
  );
  if (!c) throw new Error(`no ${code} in lib/worldCountries.json`);
  return { code, name: c.name, path: c.path, x: c.x };
}

const CH: CountryVisit = { ...shapeOf("CH"), trips: [{ id: "alps-2024", title: "Alps 2024" }] };
const TH: CountryVisit = { ...shapeOf("TH"), trips: [{ id: "asia-2023", title: "Asia 2023" }] };

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let matchMediaSpy: ReturnType<typeof vi.spyOn> | undefined;

/** Controls `(hover: hover)` / `(prefers-reduced-motion: reduce)` for the
 * component's own `window.matchMedia` checks. */
function stubMatchMedia({ hover = false, reducedMotion = false } = {}) {
  const impl = (query: string) =>
    ({
      matches: query.includes("hover: hover") ? hover : query.includes("reduce") ? reducedMotion : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
  // jsdom has no matchMedia at all — define it fresh rather than spy on an
  // undefined method the first time, then swap the implementation after.
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = impl;
  }
  matchMediaSpy = vi.spyOn(window, "matchMedia").mockImplementation(impl);
}

beforeEach(() => {
  stubMatchMedia({ reducedMotion: true }); // instant by default — no tween in flight to leak between tests
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  matchMediaSpy?.mockRestore();
});

function mount(props: Partial<React.ComponentProps<typeof LifetimeMap>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <LifetimeMap visits={[CH, TH]} pinned={null} onPinnedChange={() => {}} {...props} />
      </LocaleProvider>,
    );
  });
  return container;
}

function countryGroup(el: HTMLElement, name: string): HTMLElement {
  const el2 = [...el.querySelectorAll("g[aria-label]")].find((g) =>
    (g.getAttribute("aria-label") ?? "").startsWith(name),
  );
  if (!el2) throw new Error(`no country group for ${name}`);
  return el2 as HTMLElement;
}

describe("pinning a country (decision 7)", () => {
  test("clicking a country pins it", () => {
    const onPinnedChange = vi.fn();
    const el = mount({ onPinnedChange });
    act(() => countryGroup(el, "Switzerland").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPinnedChange).toHaveBeenCalledWith("CH");
  });

  test("clicking the same country again clears the pin", () => {
    const onPinnedChange = vi.fn();
    const el = mount({ pinned: "CH", onPinnedChange });
    act(() => countryGroup(el, "Switzerland").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPinnedChange).toHaveBeenCalledWith(null);
  });

  test("Enter on a focused country pins it, the same as a click", () => {
    const onPinnedChange = vi.fn();
    const el = mount({ onPinnedChange });
    act(() =>
      countryGroup(el, "Thailand").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(onPinnedChange).toHaveBeenCalledWith("TH");
  });

  test("Escape clears a pinned country", () => {
    const onPinnedChange = vi.fn();
    mount({ pinned: "CH", onPinnedChange });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onPinnedChange).toHaveBeenCalledWith(null);
  });

  test("the ✕ button under the map clears the pin", () => {
    const onPinnedChange = vi.fn();
    const el = mount({ pinned: "CH", onPinnedChange });
    const clear = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("✕"));
    expect(clear).toBeTruthy();
    act(() => clear!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPinnedChange).toHaveBeenCalledWith(null);
  });

  test("a pinned country renders a pulsing outline", () => {
    const el = mount({ pinned: "CH" });
    expect(countryGroup(el, "Switzerland").querySelector(".lifetime-map-pin-pulse")).not.toBeNull();
  });
});

describe("hover never pins (decision 8)", () => {
  test("with (hover: hover), hovering shows a label but never calls onPinnedChange", () => {
    stubMatchMedia({ hover: true, reducedMotion: true });
    const onPinnedChange = vi.fn();
    const el = mount({ onPinnedChange });
    act(() =>
      countryGroup(el, "Switzerland").dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true, clientX: 10, clientY: 10 }),
      ),
    );
    expect(el.textContent).toContain("Switzerland");
    expect(onPinnedChange).not.toHaveBeenCalled();
  });

  test("without (hover: hover) — a touch device — no hover handlers are attached at all", () => {
    stubMatchMedia({ hover: false, reducedMotion: true });
    const el = mount();
    act(() =>
      countryGroup(el, "Switzerland").dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true, clientX: 10, clientY: 10 }),
      ),
    );
    // No floating hover label appears — the map only shows the pinned/focus
    // caption line, and neither is set here.
    expect(el.querySelector(".pointer-events-none")).toBeNull();
  });
});

describe("continent/area buttons never filter the cards (decision 13)", () => {
  test("selecting a continent view does not touch the pinned country unless it falls outside it", () => {
    const onPinnedChange = vi.fn();
    const views = [
      { id: "all", kind: "all" as const, countryCodes: ["CH", "TH"], frame: { x: 0, y: 0, w: 100, h: 60, lngScale: 1 }, basemap: null },
      { id: "Europe", kind: "continent" as const, continent: "Europe", labelKey: "trips.map.continent.europe" as const, countryCodes: ["CH"], frame: { x: 0, y: 0, w: 50, h: 30, lngScale: 1 }, basemap: null },
      { id: "Asia", kind: "continent" as const, continent: "Asia", labelKey: "trips.map.continent.asia" as const, countryCodes: ["TH"], frame: { x: 0, y: 0, w: 50, h: 30, lngScale: 1 }, basemap: null },
    ];
    const continents = [
      { continent: "Europe", labelKey: "trips.map.continent.europe" as const, count: 1, areas: [] },
      { continent: "Asia", labelKey: "trips.map.continent.asia" as const, count: 1, areas: [] },
    ];
    const el = mount({ pinned: "CH", onPinnedChange, views, continents });
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Europe"));
    act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    // CH is still inside the Europe view, so the pin survives the switch.
    expect(onPinnedChange).not.toHaveBeenCalled();
  });

  test("switching to a region without the pinned country clears it", () => {
    const onPinnedChange = vi.fn();
    const views = [
      { id: "all", kind: "all" as const, countryCodes: ["CH", "TH"], frame: { x: 0, y: 0, w: 100, h: 60, lngScale: 1 }, basemap: null },
      { id: "Europe", kind: "continent" as const, continent: "Europe", labelKey: "trips.map.continent.europe" as const, countryCodes: ["CH"], frame: { x: 0, y: 0, w: 50, h: 30, lngScale: 1 }, basemap: null },
      { id: "Asia", kind: "continent" as const, continent: "Asia", labelKey: "trips.map.continent.asia" as const, countryCodes: ["TH"], frame: { x: 0, y: 0, w: 50, h: 30, lngScale: 1 }, basemap: null },
    ];
    const continents = [
      { continent: "Europe", labelKey: "trips.map.continent.europe" as const, count: 1, areas: [] },
      { continent: "Asia", labelKey: "trips.map.continent.asia" as const, count: 1, areas: [] },
    ];
    const el = mount({ pinned: "CH", onPinnedChange, views, continents });
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Asia"));
    act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onPinnedChange).toHaveBeenCalledWith(null);
  });
});

describe("fade outside the current selection (decision 6)", () => {
  test("a country outside the current view is drawn at reduced opacity", () => {
    const views = [
      { id: "all", kind: "all" as const, countryCodes: ["CH", "TH"], frame: { x: 0, y: 0, w: 100, h: 60, lngScale: 1 }, basemap: null },
      { id: "Europe", kind: "continent" as const, continent: "Europe", labelKey: "trips.map.continent.europe" as const, countryCodes: ["CH"], frame: { x: 0, y: 0, w: 50, h: 30, lngScale: 1 }, basemap: null },
      { id: "Asia", kind: "continent" as const, continent: "Asia", labelKey: "trips.map.continent.asia" as const, countryCodes: ["TH"], frame: { x: 0, y: 0, w: 50, h: 30, lngScale: 1 }, basemap: null },
    ];
    const continents = [
      { continent: "Europe", labelKey: "trips.map.continent.europe" as const, count: 1, areas: [] },
      { continent: "Asia", labelKey: "trips.map.continent.asia" as const, count: 1, areas: [] },
    ];
    const el = mount({ views, continents });
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Europe"));
    act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const thPath = countryGroup(el, "Thailand").querySelector("path")!;
    expect(Number(thPath.getAttribute("opacity"))).toBeLessThan(1);
    const chPath = countryGroup(el, "Switzerland").querySelector("path")!;
    expect(Number(chPath.getAttribute("opacity"))).toBe(1);
  });
});

describe("the Einstieg swaps in the 'all' view's own basemap once it runs (decision 5)", () => {
  test("under reduced motion the swap is instant, on mount", () => {
    // stubMatchMedia's beforeEach default is reduced-motion, so the
    // Einstieg's `animateTo` call takes its synchronous branch and the
    // basemap is already in place by the first paint after mount — no rAF
    // or timer to advance.
    const basemap = {
      borders: ["M9,9 L8,8 Z"],
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
    const views = [
      { id: "all" as const, kind: "all" as const, countryCodes: ["CH", "TH"], frame: { x: 0, y: 0, w: 100, h: 60, lngScale: 1 }, basemap },
    ];
    const el = mount({ views });
    expect(el.innerHTML).toContain("M9,9 L8,8 Z");
  });

  /**
   * Found while browser-testing this ticket on a real journal: the basemap
   * bundle (`lib/basemap.ts`) still has its own antimeridian-wrapped border
   * paths — the same jump-across-180° shape `scripts/build-world-countries.mts`
   * now guards against in `lib/worldCountries.json`, but in a different,
   * pre-existing dataset this ticket does not regenerate. `notAntimeridianArtifact`
   * is the narrow mitigation: drop a border whose own bounding box spans
   * almost the whole 1000-unit world, which no real border ever does at any
   * zoom this map draws.
   */
  test("drops a border path that spans almost the whole world, keeps an ordinary one", () => {
    const basemap = {
      borders: [
        "M0.0,296.0 L998.2,296.7 L996.5,297.3 Z", // the real Fiji/Russia shape found live
        "M334.5,472.3 L333.7,473.7 L332.9,475.0 Z", // an ordinary short border
      ],
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
    const views = [
      { id: "all" as const, kind: "all" as const, countryCodes: ["CH", "TH"], frame: { x: 0, y: 0, w: 100, h: 60, lngScale: 1 }, basemap },
    ];
    const el = mount({ views });
    expect(el.innerHTML).not.toContain("M0.0,296.0");
    expect(el.innerHTML).toContain("M334.5,472.3");
  });

  /**
   * Found live, on a real journal: a continent view's glide starts with no
   * basemap yet — it is still being fetched — and `animateTo`'s own
   * completion used to unconditionally set the display basemap to whatever
   * it was *called* with (`null`). On a local dev server the fetch nearly
   * always resolves before the 700ms glide finishes, so the fetch's own
   * `setDisplayBasemap` ran first and the glide's completion then
   * overwrote it right back to `null` — the ground never updated, every
   * time. `targetBasemapRef` is what both now read and write instead of a
   * captured closure value.
   */
  test("a basemap fetch that resolves before the glide finishes is not overwritten back to null", async () => {
    stubMatchMedia({ hover: false, reducedMotion: false }); // a real (short) glide, not the instant branch
    const fetched = {
      borders: ["M5,5 L6,6 Z"],
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
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({ basemap: fetched }) } as Response);

    const views = [
      { id: "all" as const, kind: "all" as const, countryCodes: ["CH", "TH"], frame: { x: 0, y: 0, w: 100, h: 60, lngScale: 1 }, basemap: null },
      { id: "Europe" as const, kind: "continent" as const, continent: "Europe", labelKey: "trips.map.continent.europe" as const, countryCodes: ["CH"], frame: { x: 0, y: 0, w: 50, h: 30, lngScale: 1 }, basemap: null },
      { id: "Asia" as const, kind: "continent" as const, continent: "Asia", labelKey: "trips.map.continent.asia" as const, countryCodes: ["TH"], frame: { x: 0, y: 0, w: 50, h: 30, lngScale: 1 }, basemap: null },
    ];
    const continents = [
      { continent: "Europe", labelKey: "trips.map.continent.europe" as const, count: 1, areas: [] },
      { continent: "Asia", labelKey: "trips.map.continent.asia" as const, count: 1, areas: [] },
    ];
    const el = mount({ views, continents });
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Europe"));

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // Let the mocked fetch's promise chain resolve — this is the "fetch
      // wins the race" case the bug needed. jsdom never fires a real
      // requestAnimationFrame, so the glide's own forced-timeout is what
      // eventually settles it (real timers here, not fake ones, since the
      // component reads `performance.now()`/`setTimeout` directly).
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700 + 350)); // GLIDE_MS + the forced-timeout's own buffer
    });

    expect(el.innerHTML).toContain("M5,5 L6,6 Z");
    fetchSpy.mockRestore();
  });
});
