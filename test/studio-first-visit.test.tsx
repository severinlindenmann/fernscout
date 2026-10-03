// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import StudioHub from "@/components/studio/StudioHub";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { StudioHubModel } from "@/lib/studio/hub";

/** B2810 — a journal with no trip yet opens on a welcome with up to three
 *  doors and a Skip; the normal hub is one press away, remembered per device. */

vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  localStorage.clear();
});
beforeEach(() => localStorage.clear());

const BASE: Extract<StudioHubModel, { kind: "empty" }> = {
  kind: "empty",
  extractOff: false,
  welcome: { nickname: "Anna", address: "fernscout.ch/@anna", polarsteps: true },
  account: { storage: null },
  print: { unfinished: [], recentOrders: [] },
  resumableImports: [],
  analyticsEnabled: false,
  postcardSuggestion: null,
  routeRecordingTrips: [],
};

function render(model: StudioHubModel) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <StudioBarProvider username="anna">
          <StudioHub username="anna" model={model} />
        </StudioBarProvider>
      </LocaleProvider>,
    );
  });
  return container;
}

const doors = (el: HTMLElement) => [...el.querySelectorAll("[data-door]")].map((a) => a.getAttribute("data-door"));

describe("first visit", () => {
  test("welcomes by name, says where the journal is and offers all three doors", () => {
    const el = render(BASE);
    expect(el.textContent).toContain("Welcome, Anna");
    expect(el.textContent).toContain("Your journal is at fernscout.ch/@anna. Nothing is published yet.");
    expect(doors(el)).toEqual(["newTrip", "polarsteps", "photos"]);
    expect(el.querySelector('[data-door="newTrip"]')?.getAttribute("href")).toBe("/@anna/studio/trip/new");
    expect(el.querySelector('[data-door="polarsteps"]')?.getAttribute("href")).toBe("/@anna/studio/import/polarsteps");
    expect(el.querySelector('[data-door="photos"]')?.getAttribute("href")).toBe("/@anna/studio/photos");
  });

  test("no nickname: just Welcome; no GPX or settings line", () => {
    const el = render({ ...BASE, welcome: { ...BASE.welcome, nickname: null } });
    expect(el.querySelector("h1")?.textContent).toBe("Welcome");
    expect(el.querySelector('a[href*="/studio/location"]')).toBeNull();
    expect(el.querySelector('a[href$="/studio/journal"]')).toBeNull();
  });

  test("a door whose capability is off is absent, not a dead button", () => {
    expect(doors(render({ ...BASE, extractOff: true }))).toEqual(["newTrip", "polarsteps"]);
    act(() => root?.unmount());
    container?.remove();
    expect(doors(render({ ...BASE, welcome: { ...BASE.welcome, polarsteps: false } }))).toEqual(["newTrip", "photos"]);
  });

  test("Skip shows the normal hub and is remembered for this journal", () => {
    const el = render(BASE);
    const skip = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Skip"))!;
    act(() => skip.click());
    expect(doors(el)).toEqual([]);
    expect(el.textContent).toContain("Nothing here yet");
    expect(localStorage.getItem("fs.studioWelcomeSkipped.anna")).toBe("1");
    // Next visit on this device: straight to the hub.
    act(() => root?.unmount());
    container?.remove();
    const again = render(BASE);
    expect(doors(again)).toEqual([]);
    expect(again.textContent).toContain("Nothing here yet");
  });
});
