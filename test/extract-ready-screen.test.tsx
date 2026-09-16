// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import ReadyScreen from "@/components/extract/ReadyScreen";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * S10b, rendered — B1803 Task 3.7.
 *
 * The rule this file exists to prove: every row is a real count read off
 * the manifest (never a guess), and "Publish this trip" is a plain link to
 * `/agent` — never a fetch to the publish route, which
 * `test/extract-no-publish.test.ts` already forbids anywhere under
 * `components/extract/` at the source level. This is the same rule,
 * checked from the rendered DOM instead: no button here has an `onClick`
 * that could reach it.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    runId: "run-1",
    owner: "alex",
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-05T00:00:00.000Z",
    tripId: "japan-2026",
    mode: "type",
    state: "committed",
    photos: [],
    days: [],
    ...overrides,
  };
}

function stub(manifest: Record<string, unknown>, spentCredits = 0) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/extract/run")) {
        return { ok: true, json: async () => ({ manifest, spentCredits }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <ReadyScreen username="alex" runId="run-1" onPreview={() => {}} />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ReadyScreen", () => {
  test("days, photographs and held-back are real counts off the manifest, not invented", async () => {
    stub(
      baseManifest({
        photos: [
          { id: "p1", filename: "p1.jpg", bytes: 1, kind: "image", date: "2026-06-01" },
          { id: "p2", filename: "p2.jpg", bytes: 1, kind: "image", date: "2026-06-01", visibility: "private" },
          { id: "p3", filename: "p3.jpg", bytes: 1, kind: "image", date: "2026-06-02", dropped: true },
        ],
        days: [
          { date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "day-1" },
          // Not committed — its photograph must not be counted.
          { date: "2026-06-02", answered: [] },
        ],
      }),
      12,
    );
    await render();

    expect(container!.textContent).toContain("Days");
    expect(container!.textContent).toContain("1");
    expect(container!.textContent).toContain("Photographs");
    expect(container!.textContent).toContain("2");
    expect(container!.textContent).toContain("Held back");
    expect(container!.textContent).toContain("1 private");
    expect(container!.textContent).toContain("Credits spent");
    expect(container!.textContent).toContain("12");
  });

  test("says 'Saved as a draft', never that anything was published", async () => {
    stub(baseManifest({ days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "day-1" }] }));
    await render();

    expect(container!.textContent).toContain("Saved as a draft");
    expect(container!.textContent).not.toMatch(/published/i);
  });

  test("'Publish this trip' is a link to /agent, not a button that calls the publish route", async () => {
    stub(baseManifest({ days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "day-1" }] }));
    await render();

    const publishLink = [...container!.querySelectorAll("a")].find((a) => a.textContent === "Publish this trip");
    expect(publishLink).toBeDefined();
    expect(publishLink!.getAttribute("href")).toBe("/agent");

    // No button on the whole screen ever fires a network call — the only
    // fetch this component makes is its own initial `extract/run` read.
    const fetchSpy = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockClear();
    for (const button of [...container!.querySelectorAll("button")]) button.click();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("has a header naming the screen — S10b, item 1 of the spec", async () => {
    stub(baseManifest({ days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "day-1" }] }));
    await render();

    expect(container!.textContent).toContain("Ready");
  });
});

/**
 * B1803 final review, findings 3 and 9.
 *
 * Finding 3: this screen counted a committed day's photographs with
 * `photo.date === day.date`, but `lib/extract/commit.ts` moves them by
 * `date ?? takenAt.slice(0,10)` — so an ordinary photograph the camera
 * dated itself, and which really is in the journal, was counted as nothing
 * here. One helper now answers that question for both screens and the
 * commit path.
 *
 * Finding 9: "Leave it as a draft" was a primary-looking button with an
 * `onClick` that did nothing at all.
 */
describe("ReadyScreen counts the photographs the commit actually moved", () => {
  test("a photograph the camera dated, with no hand-set date, still counts", async () => {
    stub(
      baseManifest({
        photos: [
          // No `photo.date` — the camera's own reading is what `commitDay`
          // moved it by, and it is in the journal.
          { id: "p1", filename: "p1.jpg", bytes: 1, kind: "image", takenAt: "2026-06-01T10:00:00" },
        ],
        days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "day-1" }],
      }),
    );
    await render();

    const photographs = [...container!.querySelectorAll("div")].find((d) =>
      d.textContent?.startsWith("Photographs"),
    );
    expect(photographs!.textContent).toBe("Photographs1");
  });

  test("'Leave it as a draft' is a real way out of the flow, not an inert button", async () => {
    stub(
      baseManifest({
        days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "day-1" }],
      }),
    );
    await render();

    const leave = [...container!.querySelectorAll("a")].find((a) => a.textContent === "Leave it as a draft");
    expect(leave).toBeDefined();
    expect(leave!.getAttribute("href")).toBe("/alex/trips/japan-2026");
  });
});
