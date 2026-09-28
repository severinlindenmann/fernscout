// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import MapControls from "@/components/map/MapControls";
import StopScopeSwitch from "@/components/map/StopScopeSwitch";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2420 (Phase 0 item 4, docs/plans/map-redesign.md): the one control column
 * every map surface will draw from, and the "Whole trip / This stop" switch.
 * Not wired into TripMap/WorldMap yet — this only proves the component
 * itself: fixed order, optional buttons, 44 px sizing, real aria labels,
 * translated in English and German, and the switch's pressed state.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function renderControls(locale: "en" | "de", props: Parameters<typeof MapControls>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
        <MapControls {...props} />
      </LocaleProvider>,
    );
  });
  return container!;
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>("button"));
}

describe("MapControls", () => {
  test("renders every button, in the fixed order, when every callback is given", () => {
    renderControls("en", {
      onZoomIn: () => {},
      onZoomOut: () => {},
      onFit: () => {},
      onLayers: () => {},
      onFullscreen: () => {},
    });
    expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Zoom in",
      "Zoom out",
      "Reset view",
      "Layers",
      "Full screen",
    ]);
  });

  test("a button renders only when its callback is given", () => {
    renderControls("en", { onZoomIn: () => {}, onFullscreen: () => {} });
    expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual(["Zoom in", "Full screen"]);
  });

  test("nothing renders with no callbacks at all", () => {
    renderControls("en", {});
    expect(buttons()).toHaveLength(0);
  });

  test("clicking a button calls its own callback and no other", () => {
    let zoomIns = 0;
    let zoomOuts = 0;
    renderControls("en", {
      onZoomIn: () => zoomIns++,
      onZoomOut: () => zoomOuts++,
    });
    act(() => {
      buttons()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(zoomIns).toBe(1);
    expect(zoomOuts).toBe(0);
  });

  test("every button is 44 px, sized with the h-11 w-11 convention shared with TripMap/WorldMap", () => {
    renderControls("en", { onZoomIn: () => {}, onLayers: () => {} });
    for (const b of buttons()) {
      expect(b.className).toContain("h-11");
      expect(b.className).toContain("w-11");
    }
  });

  test("a fullscreenClassName wraps only the full-screen button, for a caller that wants it at one breakpoint but not another (B2430)", () => {
    renderControls("en", { onZoomIn: () => {}, onFullscreen: () => {}, fullscreenClassName: "hidden lg:block" });
    const wrapper = container!.querySelector("button[aria-label='Full screen']")!.parentElement!;
    expect(wrapper.className).toBe("hidden lg:block");
    // The other button is untouched — still a direct child of the column,
    // no wrapper class leaking onto it.
    const zoomWrapper = container!.querySelector("button[aria-label='Zoom in']")!.parentElement!;
    expect(zoomWrapper.className).toBe("flex flex-col gap-1.5");
  });

  test("labels are real German, not the English fallback", () => {
    renderControls("de", {
      onZoomIn: () => {},
      onZoomOut: () => {},
      onFit: () => {},
      onLayers: () => {},
      onFullscreen: () => {},
    });
    // Read from de.json rather than spelt out here, so a spelling decision
    // (B2153 went to Swiss ss, B2416 back to ß) cannot break this; it still
    // fails on an English fallback.
    const de = dictionaryFor("de");
    const en = dictionaryFor("en");
    const keys = ["map.zoomIn", "map.zoomOut", "map.reset", "map.layers", "map.fullscreen"] as const;
    const labels = buttons().map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(keys.map((k) => de[k]));
    for (const k of keys) expect(de[k]).not.toBe(en[k]);
  });
});

function renderSwitch(locale: "en" | "de", scope: "trip" | "stop", onChange: (s: "trip" | "stop") => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
        <StopScopeSwitch scope={scope} onChange={onChange} />
      </LocaleProvider>,
    );
  });
  return container!;
}

describe("StopScopeSwitch", () => {
  test("exactly one side is aria-pressed, matching the given scope", () => {
    renderSwitch("en", "trip", () => {});
    const [trip, stop] = Array.from(container!.querySelectorAll("button[aria-pressed]"));
    expect(trip.textContent).toBe("Whole trip");
    expect(trip.getAttribute("aria-pressed")).toBe("true");
    expect(stop.textContent).toBe("This stop");
    expect(stop.getAttribute("aria-pressed")).toBe("false");
  });

  test("choosing the other side calls onChange with it", () => {
    let chosen: string | undefined;
    renderSwitch("en", "trip", (s) => {
      chosen = s;
    });
    const [, stop] = Array.from(container!.querySelectorAll("button[aria-pressed]"));
    act(() => {
      stop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(chosen).toBe("stop");
  });

  test("German labels are real, not English", () => {
    renderSwitch("de", "stop", () => {});
    const [trip, stop] = Array.from(container!.querySelectorAll("button[aria-pressed]"));
    expect(trip.textContent).toBe("Ganze Reise");
    expect(stop.textContent).toBe("Dieser Ort");
  });
});
