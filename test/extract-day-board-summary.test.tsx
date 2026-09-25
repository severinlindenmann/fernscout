// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import DayBoard from "@/components/extract/DayBoard";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * The day card's summary line (S5a) — B1803 Task 3.2. No weather field
 * exists anywhere in a staged run's own data (`RunManifest`/`DayRow`/
 * `DayGroup`) — it is looked up later, once a day is actually committed into
 * the journal. This board must never print a temperature or a condition it
 * has not actually seen; the line reads "place · count" (or, with no known
 * place, "count · none of them know where they were") and nothing more.
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
      if (url.includes("/studio/run")) {
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
                { id: "p1", filename: "a.jpg", bytes: 1, kind: "image" as const },
                { id: "p2", filename: "b.jpg", bytes: 1, kind: "image" as const },
                { id: "p3", filename: "c.jpg", bytes: 1, kind: "image" as const },
              ],
              days: [],
            },
            groups: [
              // Told, real place from the run route's own reverse-geocode —
              // no open questions at all.
              { date: "2026-06-01", photoIds: ["p1"], lat: 15.88, lng: 108.33, undated: false, placeName: "Hoi An" },
              // No coordinate at all — the location gap question is real, so
              // this reads "no place", not merely "not yet".
              { date: "2026-06-02", photoIds: ["p2", "p3"], undated: false },
            ],
            questions: {
              "2026-06-01": [],
              "2026-06-02": [{ id: "where:2026-06-02", kind: "gap", fills: "location", text: "?" }],
            },
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
        <DayBoard username="alex" runId="run-1" consentedSpeech={false} speechProvider="none" onLeave={() => {}} />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the day card summary line", () => {
  test("a told day with a real place reads 'place · count photographs', no invented weather", async () => {
    await render();
    expect(container!.textContent).toContain("Hoi An · one photograph");
    expect(container!.textContent).toContain("told");
    // No fabricated temperature or condition — the true absence of a
    // weather field for a staged run, never a guessed one.
    expect(container!.textContent).not.toMatch(/\d+°/);
  });

  test("a day with no known place reads 'count · none of them know where they were' and the pill says 'no place'", async () => {
    await render();
    expect(container!.textContent).toContain("2 photographs · none of them know where they were");
    expect(container!.textContent).toContain("no place");
  });
});
