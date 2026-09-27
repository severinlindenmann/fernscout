// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import OfflineTrips from "@/components/OfflineTrips";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2463 — the "Save recent trips automatically" switch defaults on inside
 * the shell or an installed PWA (`display-mode: standalone`) and off in an
 * ordinary browser tab, unless the reader already chose for themselves
 * (`localStorage`, per-device). Also covers the list itself: capped to the
 * always-shown set with "Show N more trips" behind it, same idea
 * `TripsIndexContent.tsx`'s locked-trips list already uses.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function stubWorkerControlled() {
  vi.stubGlobal("navigator", {
    ...window.navigator,
    serviceWorker: {
      controller: { postMessage: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      getRegistration: async () => undefined,
    },
    storage: {
      estimate: async () => ({ usage: 0 }),
      persist: async () => true,
      persisted: async () => true,
    },
  });
}

function stubCaches() {
  vi.stubGlobal("caches", { keys: async () => [] });
}

function stubStandalone(standalone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // jsdom always has localStorage; nothing to guard here in practice.
  }
  act(() => root?.unmount());
  vi.unstubAllGlobals();
  container?.remove();
  root = undefined;
  container = undefined;
});

const trips = [
  { id: "current-trip", title: "Ungarn 2026", status: "current" as const, end: "2026-10-01" },
  { id: "old-trip", title: "Elsass 2018", status: "past" as const, end: "2018-01-01" },
];

async function render() {
  stubWorkerControlled();
  stubCaches();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <OfflineTrips username="alex" trips={trips} />
      </LocaleProvider>,
    );
  });
}

describe("OfflineTrips auto-save default (B2463)", () => {
  test("an installed PWA defaults the switch on", async () => {
    stubStandalone(true);
    await render();
    const toggle = container!.querySelector('button[role="switch"][aria-label="Save recent trips automatically"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
  });

  test("an ordinary browser tab defaults the switch off", async () => {
    stubStandalone(false);
    await render();
    const toggle = container!.querySelector('button[role="switch"][aria-label="Save recent trips automatically"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
  });

  test("an explicit device choice overrides the display-mode default", async () => {
    stubStandalone(true);
    localStorage.setItem("fernscout-autosave-trips", "0");
    await render();
    const toggle = container!.querySelector('button[role="switch"][aria-label="Save recent trips automatically"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
  });
});
