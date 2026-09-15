// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import CreditsScreen from "@/components/extract/CreditsScreen";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * The credits screen — B1751 Task 4.1, Step 5.
 *
 * Same jsdom + `createRoot` harness as `test/day-notify-nobody.test.tsx`,
 * rather than adding `@testing-library/react` for one component.
 *
 * The one thing this file exists to hold: `extract.credits.tiedToRun` is
 * present and appears BEFORE the spend button in document order. That
 * sentence is the whole difference between a term somebody agreed to and a
 * trap sprung after the fact — a reviewer, or this test, can check its
 * position without reading a screenshot.
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

function stubRunWithPhotos(count: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/extract/run")) {
        return {
          ok: true,
          json: async () => ({
            manifest: {
              version: 1,
              runId: "run-1",
              owner: "alex",
              createdAt: "2026-09-01T00:00:00.000Z",
              expiresAt: "2026-09-05T00:00:00.000Z",
              tripId: null,
              mode: "type",
              state: "telling",
              photos: Array.from({ length: count }, (_, i) => ({
                id: `p${i}`,
                filename: `p${i}.jpg`,
                bytes: 1,
                kind: "image",
              })),
              days: [],
              sampleTakenFor: "run-1",
            },
            groups: [],
            questions: {},
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function render(credits: number, photoCount: number) {
  stubRunWithPhotos(photoCount);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <CreditsScreen username="alex" runId="run-1" credits={credits} onDone={() => {}} />
      </LocaleProvider>,
    );
  });
  // Let the run fetch's promise chain resolve.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the credits screen", () => {
  test("says what a spend is tied to, above the button, when there is something to price", async () => {
    await render(10, 12);

    const tied = container!.querySelector('[data-testid="tied-to-run"]');
    const button = container!.querySelector('[data-testid="extract-spend-button"]');
    expect(tied?.textContent).toContain("written into your import");
    expect(button).not.toBeNull();

    // DOCUMENT_POSITION_FOLLOWING (4): the button comes AFTER the sentence.
    const order = tied!.compareDocumentPosition(button!);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("prices from the real function, not a number typed into the screen", async () => {
    const { creditsForPhotos } = await import("@/lib/helper/credits");
    await render(10, 23);

    const button = container!.querySelector('[data-testid="extract-spend-button"]');
    expect(button?.textContent).toContain(String(creditsForPhotos(23)));
  });

  test("the free build path is offered alongside the paid one", async () => {
    await render(10, 12);

    expect(container!.textContent).toContain("Build it from what I wrote");
  });
});
