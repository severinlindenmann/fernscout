// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import FoundStep from "@/components/extract/FoundStep";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * Step 04 — "what the photographs already knew" (B1797). Every number on
 * this screen is a count over the manifest `GET .../extract/run` already
 * returns; this asserts the arithmetic against a fixture with a mix of
 * dated/undated, placed/unplaced, dropped/live photographs, rather than the
 * screen merely rendering without crashing.
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

test("counts dates, places and time-of-day out of the live photographs only", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          manifest: {
            version: 1,
            runId: "run-1",
            owner: "alex",
            createdAt: "2026-09-01T00:00:00.000Z",
            expiresAt: "2026-09-03T00:00:00.000Z",
            tripId: null,
            mode: "type",
            state: "analysed",
            photos: [
              { id: "a", filename: "a.jpg", bytes: 1, kind: "image", date: "2019-07-02", lat: 1, lng: 1, takenAt: "2019-07-02T10:00:00" },
              { id: "b", filename: "b.jpg", bytes: 1, kind: "image", date: "2019-07-02" }, // no place, no time
              { id: "c", filename: "c.jpg", bytes: 1, kind: "image", dropped: true, lat: 1, lng: 1 }, // dropped, excluded
            ],
            days: [],
          },
          groups: [
            { date: "2019-07-02", photoIds: ["a", "b"], undated: false },
            { date: "", photoIds: [], undated: true },
          ],
        }),
      }) as Response,
    ),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <FoundStep username="alex" runId="run-1" onContinue={() => {}} />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const text = container!.textContent ?? "";
  // 2 live photographs (the dropped one excluded), 1 dated day (the undated
  // group excluded).
  expect(text).toContain("2 photographs");
  expect(text).toContain("one day");
  // Dates: both live photos have one. Places and time-of-day: only "a" does.
  expect(text).toContain("2 / 2");
  expect(text).toContain("1 / 2");
});
