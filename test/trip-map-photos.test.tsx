// @vitest-environment jsdom
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import TripMap from "@/components/TripMap";
import LocaleProvider from "@/components/LocaleProvider";
import TripProvider from "@/components/TripProvider";
import { dictionaryFor } from "@/lib/locales";
import { storyWindow } from "@/lib/tripView";
import type { StopSource } from "@/lib/tripMap";
import type { Trip } from "@/lib/types";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2429 — stop photo markers and the carousel card's thumbnail.
 *
 * Two things this has to keep being true: a photo only turns a stop's marker
 * into a `PhotoMarker` once the reader is zoomed to town scale (never at the
 * whole-trip view, and never larger than the map itself the way B46 already
 * guards every other marker), and it never comes from a day this reader may
 * not see at all — a draft, or a photo labelled below their level. That
 * second guarantee is `lib/entries.ts`'s own `visible()`/`maySeePhoto`,
 * reused through `storyWindow` (the same function `/@<user>/story.json`
 * calls) rather than re-implemented here — see `TripMap`'s photo-fetching
 * effect and `TripStop.photo`'s own doc in lib/tripMap.ts.
 */

class StubResizeObserver {
  observe() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

const alps: StopSource[] = [
  { date: "2024-06-01", location: "Grimsel", country: "Switzerland", countryCode: "CH", lat: 46.5606, lng: 8.3428 },
  { date: "2024-06-02", location: "Furka", country: "Switzerland", countryCode: "CH", lat: 46.5713, lng: 8.4113 },
];

const trip = {
  id: "alps-2024",
  username: "alex",
  ref: "alex/alps-2024",
  visibility: "public",
  listed: true,
} as unknown as Trip;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

/** Renders `TripMap` inside a `TripProvider` (unlike test/trip-map.test.tsx,
 * which deliberately has none) and stubs `fetch` to answer like
 * `/@<user>/story.json` would, for the one stop named in `photoFor`. */
async function render(days: StopSource[], photoFor?: { date: string; src: string }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      from: 0,
      days: photoFor
        ? [
            {
              date: photoFor.date,
              entries: [{ gallery: [{ src: photoFor.src, type: "image", width: 1200, height: 800 }] }],
            },
          ]
        : [],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <TripProvider trip={trip} isCurrent>
          <TripMap days={days} />
        </TripProvider>
      </LocaleProvider>,
    );
    // Flush the stubbed fetch's own promise chain and the state update that
    // follows it — both are microtasks, not a real network round trip.
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container: container!, fetchMock };
}

function html() {
  return container!.innerHTML;
}

function clickThisStop() {
  act(() => {
    Array.from(container!.querySelectorAll("button"))
      .find((b) => b.textContent === "This stop")!
      .click();
  });
}

describe("photo markers only at town zoom", () => {
  test("a photo the reader may see is fetched from story.json, not carried on the day itself", async () => {
    const { fetchMock } = await render(alps, { date: alps[1].date, src: "/media/alps-2024/furka/01.jpg" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/@alex/story.json");
    expect(url).toContain(`trip=${encodeURIComponent("alex/alps-2024")}`);
  });

  test("the whole-trip view never draws a photo marker, even once a photo has arrived", async () => {
    await render(alps, { date: alps[1].date, src: "/media/alps-2024/furka/01.jpg" });
    // Two stops default to the whole-trip view (lib/mapFrame's frame is the
    // whole route, far short of town scale).
    expect(html()).not.toContain("<image");
  });

  test("This stop reaches town zoom and draws the photo marker, lazily and at the thumbnail width", async () => {
    await render(alps, { date: alps[1].date, src: "/media/alps-2024/furka/01.jpg" });
    clickThisStop();
    expect(html()).toContain("<image");
    // `mediaLoader`'s own `?w=`, the nearest allowed width to the 160 asked
    // for (lib/mediaSizes.ts) — never the original file.
    expect(html()).toContain("/media/alps-2024/furka/01.jpg?w=160");
  });

  test("a stop with no photo keeps its plain numbered marker even at town zoom", async () => {
    await render(alps, undefined);
    clickThisStop();
    expect(html()).not.toContain("<image");
  });

  test("the carousel row's own thumbnail is the same lazy, thumbnail-width image", async () => {
    await render(alps, { date: alps[1].date, src: "/media/alps-2024/furka/01.jpg" });
    const img = container!.querySelector("li img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/media/alps-2024/furka/01.jpg?w=160");
    expect(img!.getAttribute("loading")).toBe("lazy");
  });
});

describe("privacy: a photo this reader may not see never reaches the map", () => {
  let dir: string;
  const OWNER = "priv";
  const REF = `${OWNER}/reise-2026`;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-map-photo-privacy-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
    );
    fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
    fs.writeFileSync(
      path.join(dir, OWNER, "config.json"),
      JSON.stringify({
        title: "Priv",
        owner: { name: "A B", nickname: "A" },
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
      }),
    );
    writeTripFixture(OWNER, {
      id: "reise-2026",
      title: "Reise",
      start: "2026-08-01",
      end: "2026-08-03",
      status: "past",
      visibility: "public",
    });
    // Day 1: an ordinary published day with a public photo — the control.
    writeDayFixture(dir, OWNER, "reise-2026", {
      slug: "ordinary",
      date: "2026-08-01",
      title: "Ankunft",
      location: "Bellinzona",
      country: "Switzerland",
      content: "Ankunft.",
      media: [{ src: "/media/reise-2026/ordinary/01.jpg" }],
    });
    // Day 2: a draft — must not appear in the window at all.
    writeDayFixture(dir, OWNER, "reise-2026", {
      slug: "draft-day",
      date: "2026-08-02",
      title: "Noch nicht",
      location: "Bellinzona",
      country: "Switzerland",
      content: "Draft.",
      status: "draft",
      media: [{ src: "/media/reise-2026/draft-day/01.jpg" }],
    });
    // Day 3: published, but its only photo is held back from every reader
    // below the owner.
    writeDayFixture(dir, OWNER, "reise-2026", {
      slug: "hidden-photo",
      date: "2026-08-03",
      title: "Weiter",
      location: "Bellinzona",
      country: "Switzerland",
      content: "Weiter.",
      media: [{ src: "/media/reise-2026/hidden-photo/01.jpg", visibility: "private" }],
    });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** The same one-line extraction `TripMap`'s photo-fetching effect applies
   * to a `story.json` day — see lib/tripMap.ts's `TripStop.photo` doc. */
  function firstPhoto(days: ReturnType<typeof storyWindow>, date: string) {
    const day = days.find((d) => d.date === date);
    if (!day) return undefined;
    return day.entries.flatMap((e) => e.gallery).find((g) => g.type === "image");
  }

  test("a draft day is absent from the window a reader's browser fetches — no photo, no day", () => {
    const days = storyWindow(REF, 0, 3, { reader: undefined });
    expect(days.some((d) => d.date === "2026-08-02")).toBe(false);
  });

  test("a private-labelled photo's day is present, but carries no photo for this reader", () => {
    const days = storyWindow(REF, 0, 3, { reader: undefined });
    expect(days.some((d) => d.date === "2026-08-03")).toBe(true);
    expect(firstPhoto(days, "2026-08-03")).toBeUndefined();
  });

  test("an ordinary day's public photo is exactly what would become its marker", () => {
    const days = storyWindow(REF, 0, 3, { reader: undefined });
    expect(firstPhoto(days, "2026-08-01")?.src).toContain("ordinary/01.jpg");
  });
});
