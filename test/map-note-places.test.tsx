// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import MobileMapSheet from "@/components/map/MobileMapSheet";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { mapNoteFlags, mapNoteToShow } from "@/lib/map/mapNote";
import { canOfferPlace, placePatch } from "@/lib/map/usePlace";
import type { MapDay } from "@/lib/map/mapDays";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const NOW = Date.parse("2026-10-11T12:00:00Z");
const day = (date: string, hasPlace = false, extra: Partial<MapDay> = {}): MapDay => ({
  date, slug: `${date}-x`, location: "", country: "", lat: NaN, lng: NaN, hasPlace, mediaCount: 0, updates: 1, ...extra,
});

describe("B-2998 map note flags", () => {
  const days = [day("2026-10-01"), day("2026-10-10"), day("2026-10-11"), day("2026-10-02", true), day("2026-10-03", false, { hidden: true })];
  test("a reader without live access counts the days inside the recency window", () => {
    expect(mapNoteFlags(days, new Set(), false, false, NOW)).toEqual({ delayedDays: 2, daysWithoutPosition: 0 });
  });
  test("live readers and the owner are never told of a delay", () => {
    expect(mapNoteFlags(days, new Set(), true, false, NOW).delayedDays).toBe(0);
    expect(mapNoteFlags(days, new Set(), true, true, NOW).delayedDays).toBe(0);
  });
  test("owner: days with no coordinates, anchor, pin (or hidden place) are counted", () => {
    expect(mapNoteFlags(days, new Set(["2026-10-10"]), true, true, NOW).daysWithoutPosition).toBe(2);
    expect(mapNoteFlags(days, new Set(), false, false, NOW).daysWithoutPosition).toBe(0);
  });
  test("the note shows only when no place is drawn", () => {
    expect(mapNoteToShow(0, { delayedDays: 1, daysWithoutPosition: 0 })).toBe("delayed");
    expect(mapNoteToShow(0, { delayedDays: 0, daysWithoutPosition: 3 })).toBe("unplaced");
    expect(mapNoteToShow(2, { delayedDays: 1, daysWithoutPosition: 3 })).toBeNull();
    expect(mapNoteToShow(0, { delayedDays: 0, daysWithoutPosition: 0 })).toBeNull();
    expect(mapNoteToShow(0, undefined)).toBeNull();
  });
});

describe("B-2996 use this place", () => {
  test("offered only to the lookup owner, for a named day without a place", () => {
    const d = { hasPlace: false, location: "Bled" };
    expect(canOfferPlace(d, true)).toBe(true);
    expect(canOfferPlace(d, false)).toBe(false);
    expect(canOfferPlace({ ...d, location: "  " }, true)).toBe(false);
    expect(canOfferPlace({ ...d, hasPlace: true }, true)).toBe(false);
    expect(canOfferPlace({ ...d, hidden: true }, true)).toBe(false);
  });
  test("the write is coordinates and nothing else", () => {
    expect(placePatch({ displayName: "Bled", country: "Slovenia", lat: 46.37, lon: 14.11 })).toEqual({ coordinates: { lat: 46.37, lng: 14.11 } });
  });

  let host: HTMLDivElement | undefined;
  afterEach(() => { host?.remove(); host = undefined; });
  function mount(placeLookup?: { username: string; tripId: string }) {
    host = document.createElement("div");
    document.body.appendChild(host);
    const days = [day("2024-05-01", false, { location: "Bled" })];
    act(() => {
      createRoot(host!).render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <MobileMapSheet days={days} places={[]} hrefForDay={(s) => `/day/${s}`} selectedDate="2024-05-01" onSelectDate={() => {}} placeLookup={placeLookup} />
        </LocaleProvider>,
      );
    });
  }
  test("the sheet shows the button only when the page handed it placeLookup", () => {
    const half = () => act(() => host!.querySelector("button")!.click()); // the first button is the drag handle: peek -> half
    mount();
    half();
    expect(host!.textContent).toContain("Read the day");
    expect(document.querySelector("[data-use-this-place]")).toBeNull();
    host!.remove();
    mount({ username: "alex", tripId: "t" });
    half();
    expect(document.querySelector("[data-use-this-place]")).not.toBeNull();
  });
});
