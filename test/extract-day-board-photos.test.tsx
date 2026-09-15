// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import DayBoard from "@/components/extract/DayBoard";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1803 Task 1.3 — the day board carries a strip of the day's photographs,
 * and expanding a day shows each photograph beside its own edit chips
 * (`PhotoChips`, wired the same task) rather than a bare filename. This is
 * the "put photographs on every screen that talks about them" guarantee for
 * S5a and, once expanded, S6a — checked here without a screenshot: the tile
 * `PhotoStrip` renders carries the real staged-thumbnail route, built from
 * the same `username`/`runId` the board itself was given.
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

function stubRun() {
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
              photos: [
                { id: "p1", filename: "p1.jpg", bytes: 1, kind: "image" as const },
                { id: "p2", filename: "p2.jpg", bytes: 1, kind: "image" as const },
              ],
              days: [],
            },
            groups: [{ date: "2026-06-01", photoIds: ["p1", "p2"], undated: false }],
            questions: { "2026-06-01": [] },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function render() {
  stubRun();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <DayBoard
          username="alex"
          runId="run-1"
          consentedSpeech={false}
          speechProvider="none"
          onLeave={() => {}}
        />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the day board shows the day's own photographs", () => {
  test("a strip of tiles renders from the staged-thumb route, on the collapsed card", async () => {
    await render();

    const tile = container!.querySelector('button[aria-label="p1.jpg"]');
    expect(tile).not.toBeNull();
    const img = tile!.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/helper/alex/extract/thumb/run-1/p1");
  });

  test("expanding the day shows each photograph beside its chips, not a bare filename", async () => {
    await render();

    const dayButton = container!.querySelector('button[aria-expanded]')!;
    await act(async () => {
      dayButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Two thumbnails now: one on the collapsed strip, one per PhotoChips row.
    const tiles = container!.querySelectorAll('button[aria-label="p1.jpg"]');
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    // The old bare-filename row is gone.
    expect(container!.querySelector("span.truncate")).toBeNull();
  });
});
