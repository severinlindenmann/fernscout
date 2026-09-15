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

function stubRunWithPhotos(count: number, opts: { sampleTakenFor?: string | null } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
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
              sampleTakenFor: opts.sampleTakenFor === undefined ? "run-1" : opts.sampleTakenFor,
            },
            groups: [],
            questions: {},
          }),
        } as Response;
      }
      if (url.includes("/extract/sample")) {
        return { ok: true, json: async () => ({ caption: "A quiet street in Hoi An." }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return calls;
}

async function render(credits: number, photoCount: number, opts: { sampleTakenFor?: string | null } = {}) {
  const calls = stubRunWithPhotos(photoCount, opts);
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
  return calls;
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

  // B1803 Task 1.3 — S9a: "A grid of photographs to choose from" replaces the
  // old auto-request of whichever photograph sorted first.
  describe("the free sample is picked from a grid, not assumed", () => {
    test("no sample is requested until a photograph is tapped", async () => {
      const calls = await render(10, 3, { sampleTakenFor: null });

      expect(calls.some((u) => u.includes("/extract/sample"))).toBe(false);
      expect(container!.textContent).toContain("Pick any photograph.");
      expect(container!.querySelectorAll('button[aria-label="p0.jpg"]').length).toBeGreaterThan(0);
    });

    // Fix round finding: a tap used to spend the one, irreversible free
    // sample directly off a small grid tile, with no way to see the
    // photograph large first. A tap now only opens the viewer.
    test("tapping a tile opens the viewer instead of spending the sample", async () => {
      await render(10, 3, { sampleTakenFor: null });

      const tile = container!.querySelector('button[aria-label="p1.jpg"]') as HTMLElement;
      await act(async () => {
        tile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      const fetchMock = globalThis.fetch as unknown as { mock: { calls: [RequestInfo | URL, RequestInit?][] } };
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/extract/sample"))).toBe(false);
      // The viewer is open, large, over that same photograph.
      expect(container!.querySelector('[aria-label="Close"]')).not.toBeNull();
      expect(container!.textContent).toContain("Use this one");
    });

    test("only the viewer's own action requests the sample, for exactly the photograph that was open", async () => {
      await render(10, 3, { sampleTakenFor: null });

      const tile = container!.querySelector('button[aria-label="p1.jpg"]') as HTMLElement;
      await act(async () => {
        tile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const useThisOne = Array.from(container!.querySelectorAll("button")).find(
        (b) => b.textContent === "Use this one",
      ) as HTMLElement;
      expect(useThisOne).toBeDefined();
      await act(async () => {
        useThisOne.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      const fetchMock = globalThis.fetch as unknown as { mock: { calls: [RequestInfo | URL, RequestInit?][] } };
      const sampleCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/extract/sample"));
      expect(sampleCall).toBeDefined();
      expect(JSON.parse(String(sampleCall![1]?.body)).photoId).toBe("p1");
      expect(container!.textContent).toContain("A quiet street in Hoi An.");
    });

    test("a run that already has its sample offers no grid to pick from again", async () => {
      await render(10, 3, { sampleTakenFor: "run-1" });

      expect(container!.textContent).not.toContain("Pick any photograph.");
    });
  });
});
