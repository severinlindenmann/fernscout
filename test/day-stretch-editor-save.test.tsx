// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import DayStretchEditor from "@/components/studio/location/DayStretchEditor";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/components/studio/location/DayLineMap", () => ({ default: () => null }));
vi.mock("@/components/WorldMap", () => ({ default: () => null }));

/**
 * B2563 wave 2 — the day editor's writes. The GET document carries a
 * read-only `limits` block; the write schema is strict and refused every
 * save with "Unrecognized key: limits" until put() sent exactly the three
 * writable keys. Found in the browser, never by a unit test — this is that
 * test.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

const DOC = {
  hiddenSpots: [],
  hiddenStretches: [],
  namedStretches: [],
  limits: { maxSpots: 20, maxStretches: 20, maxNamed: 20, radiusM: { min: 50, max: 5000 }, labelMax: 80 },
};

test("Hide from readers sends only hiddenSpots, hiddenStretches and namedStretches", async () => {
  const calls: { method?: string; body?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method, body: init?.body as string | undefined });
      return { ok: true, status: 200, headers: new Headers({ etag: '"1"' }), json: async () => DOC };
    }),
  );
  const t0 = Date.UTC(2024, 8, 13, 6, 0);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <DayStretchEditor
          username="example"
          tripId="alps-2024"
          date="2024-09-13"
          points={[
            [46.72, 8.18],
            [46.7, 8.2],
            [46.68, 8.25],
          ]}
          times={[t0, t0 + 600_000, t0 + 1_200_000]}
          modes={["driving", "driving", "driving"]}
          gapAfter={[false, false]}
          timezone="Europe/Zurich"
          streetMapsOn={false}
        />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
  const hide = [...container.querySelectorAll("button")].find((b) => b.textContent === dictionaryFor("en")["studio.location.stretch.hide"]);
  expect(hide).toBeDefined();
  await act(async () => {
    hide!.click();
    await Promise.resolve();
  });
  const put = calls.find((c) => c.method === "PUT");
  expect(put).toBeDefined();
  expect(Object.keys(JSON.parse(put!.body!)).sort()).toEqual(["hiddenSpots", "hiddenStretches", "namedStretches"]);
});
