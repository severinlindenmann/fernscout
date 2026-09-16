// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import DayBoard from "@/components/extract/DayBoard";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1803 Phase 2 fix round 1, finding 2 — `tn("extract.step.daysTold", …)`
 * must pick its `.one` variant off `daysTotal` (the noun "day(s)" describes
 * the trip's own day count), not off `daysTold` (how many of them are done).
 * One day told out of nine must still read "9", plural — the bug read "1 of
 * 9 day told" instead, and it went unnoticed because `npm run verify` has no
 * test on the actual rendered label text.
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
  // Nine real day groups, one of them ("2026-06-01") with no open questions
  // left — completenessFor reads that as "ready"/"told" — and eight still
  // open. daysTold = 1, daysTotal = 9.
  const dates = Array.from({ length: 9 }, (_, i) => `2026-06-0${i + 1}`);
  const groups = dates.map((date) => ({ date, photoIds: [`p-${date}`], undated: false }));
  const questions = Object.fromEntries(
    dates.map((date, i) => [date, i === 0 ? [] : [{ id: `q-${date}`, kind: "opening", text: "?" }]]),
  );
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
              photos: dates.map((date) => ({ id: `p-${date}`, filename: `${date}.jpg`, bytes: 1, kind: "image" as const })),
              days: [],
            },
            groups,
            questions,
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

describe("the day board's progress label pluralises off the trip's day count", () => {
  test("one day told out of nine still reads '1 of 9 days told', not 'day'", async () => {
    await render();

    expect(container!.textContent).toContain("1 of 9 days told");
    expect(container!.textContent).not.toContain("1 of 9 day told");
  });
});

describe("the day board's day count matches what FoundStep already promised", () => {
  test("B1803 Phase 2 fix round 1, finding 1 — an undated group must not inflate the denominator", async () => {
    // Two real days plus one undated group — `groupIntoDays` always appends
    // the undated group last (`lib/extract/group.ts`), so this mirrors a
    // real run rather than reordering groups by hand.
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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
                runId: "run-2",
                owner: "alex",
                createdAt: "2026-09-01T00:00:00.000Z",
                expiresAt: "2026-09-05T00:00:00.000Z",
                tripId: null,
                mode: "type",
                state: "telling",
                photos: [
                  { id: "p1", filename: "p1.jpg", bytes: 1, kind: "image" as const },
                  { id: "p2", filename: "p2.jpg", bytes: 1, kind: "image" as const },
                  { id: "p3", filename: "p3.jpg", bytes: 1, kind: "image" as const },
                ],
                days: [],
              },
              groups: [
                { date: "2026-06-01", photoIds: ["p1"], undated: false },
                { date: "2026-06-02", photoIds: ["p2"], undated: false },
                { date: "", photoIds: ["p3"], undated: true },
              ],
              questions: {
                "2026-06-01": [{ id: "q1", kind: "opening", text: "?" }],
                "2026-06-02": [{ id: "q2", kind: "opening", text: "?" }],
                undated: [{ id: "q3", kind: "gap", text: "?" }],
              },
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    await act(async () => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <DayBoard
            username="alex"
            runId="run-2"
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

    // Two real days, none told yet — "0 of 2 days told", never "of 3".
    expect(container!.textContent).toContain("0 of 2 days told");
    expect(container!.textContent).not.toContain("of 3 days told");
  });
});

/**
 * B1803 final review, finding 5 — the counter beside the bar and the bar
 * itself disagreed. The bar's denominator is `answered + open`; the card's
 * was `open` alone, so it shrank as answers landed and the same remaining
 * question re-read itself as "1 of 1" while the bar sat at 50%. A
 * question's position within a day has to be stable while the day is being
 * answered.
 */
describe("a question's position within its day is stable as answers land", () => {
  function stubPartlyAnswered() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).includes("/extract/run")) throw new Error(`unexpected fetch: ${input}`);
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
              photos: [],
              // One of this day's two questions is already answered.
              days: [{ date: "2026-06-02", answered: ["q1"], words: "We walked." }],
            },
            groups: [{ date: "2026-06-02", photoIds: [], undated: false }],
            questions: { "2026-06-02": [{ id: "q2", kind: "opening", text: "And then?" }] },
          }),
        } as Response;
      }),
    );
  }

  test("the one question left of two reads '2 of 2', matching the bar's own 50%", async () => {
    stubPartlyAnswered();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <DayBoard username="alex" runId="run-1" consentedSpeech={false} speechProvider="" onLeave={() => {}} />
        </LocaleProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const dayButton = [...container!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("2026-06-02"),
    )!;
    await act(async () => {
      dayButton.click();
    });

    // The question counter in the card's own header, right after the day's
    // weekday — "day 1 of 1" beside it is the *day* label and is correct.
    expect(container!.textContent).toContain("Tuesday2 of 2");
    expect(container!.innerHTML).toContain("width: 50%");
  });
});
