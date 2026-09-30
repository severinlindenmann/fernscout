// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import TrackEditsPanel from "@/components/studio/location/TrackEditsPanel";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

// B2549: the panel refreshes the router after a save.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

/**
 * B2544 — the studio's own warning when a day's own typed pin falls inside a
 * hidden spot: readers no longer get it drawn (`test/hidden-spot-places.test.ts`
 * covers that side), so the owner needs to be told here, with a link
 * straight to the day that needs a look.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

const EMPTY_DOC = {
  hiddenSpots: [] as { id: string; lat: number; lon: number; radiusM: number }[],
  hiddenStretches: [],
  namedStretches: [],
  limits: { maxSpots: 20, maxStretches: 20, maxNamed: 20, radiusM: { min: 50, max: 5000 }, labelMax: 80 },
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      headers: new Headers({ etag: "\"1\"" }),
      json: async () => EMPTY_DOC,
    })),
  );
}

async function render(hiddenDays: { date: string; slug: string; location: string }[]) {
  stubFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <TrackEditsPanel username="hs" tripId="hidden-spot-trip" days={["2026-09-01"]} hiddenDays={hiddenDays} />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

async function renderReadOnly(doc: typeof EMPTY_DOC) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, headers: new Headers({ etag: '"1"' }), json: async () => doc })),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <TrackEditsPanel username="hs" tripId="hidden-spot-trip" canAdd={false} />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

describe("TrackEditsPanel own-pin warning — B2544", () => {
  test("renders a warning and a link to the day when its own pin is hidden", async () => {
    await render([{ date: "2026-09-01", slug: "at-the-hotel", location: "The Hotel" }]);
    const warning = container!.querySelector('[role="alert"]');
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toContain("own pin");
    const link = container!.querySelector('a[href*="studio/day/edit"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toContain("slug=at-the-hotel");
  });

  test("no warning when nothing is hidden", async () => {
    await render([]);
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });
});

/**
 * B2568, item 6 — the trip page's own read-only use (`canAdd={false}`) has no
 * form to show, so an empty spot or stretch list is not worth a heading and
 * an "empty" placeholder any more: one quiet line stands in when there is
 * nothing at all, and a section only appears once it has something to list.
 */
describe("TrackEditsPanel read-only mode collapses to one line when empty — B2568", () => {
  test("no edits at all: no headings, one quiet line", async () => {
    await renderReadOnly(EMPTY_DOC);
    expect(container!.textContent).toContain("Nothing set aside on this trip yet.");
    expect(container!.textContent).not.toContain("Hidden spots");
    expect(container!.textContent).not.toContain("Hidden and named stretches");
  });

  test("a hidden spot exists: its own section shows, the stretches section does not", async () => {
    await renderReadOnly({
      ...EMPTY_DOC,
      hiddenSpots: [{ id: "s1", lat: 1, lon: 1, radiusM: 100 }],
    });
    expect(container!.textContent).toContain("Hidden spots");
    expect(container!.textContent).not.toContain("Hidden and named stretches");
    expect(container!.textContent).not.toContain("Nothing set aside on this trip yet.");
  });
});
