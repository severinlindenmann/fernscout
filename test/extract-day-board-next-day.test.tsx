// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import DayBoard from "@/components/extract/DayBoard";
import LocaleProvider from "@/components/LocaleProvider";
import StudioBarProvider from "@/components/studio/StudioBar";
import { dictionaryFor } from "@/lib/locales";

/**
 * The design's primary button below the day list (S5a) — B1803 fix round 1.
 * design-v2.html:704 and the per-screen spec both put it here, naming the
 * next day worth doing ("Tell me about Friday"); binding over Phase 3's own
 * three-bullet summary, which is a summary and not a narrower scope.
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

function manifestWith(days: { date: string; answered?: string[] }[]) {
  return {
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
    ],
    days: days.map((d) => ({ date: d.date, answered: d.answered ?? [] })),
  };
}

async function render(groups: unknown, questions: unknown, manifest: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/studio/run")) {
        return { ok: true, json: async () => ({ manifest, groups, questions }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <StudioBarProvider username="alex">
        <DayBoard username="alex" runId="run-1" consentedSpeech={false} speechProvider="none" onLeave={() => {}} />
        </StudioBarProvider>
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the primary button below the day list", () => {
  test("names the real next untold day by its real weekday — 2026-06-02 is a Tuesday", async () => {
    await render(
      [
        { date: "2026-06-01", photoIds: ["p1"], undated: false },
        { date: "2026-06-02", photoIds: ["p2"], undated: false },
      ],
      {
        "2026-06-01": [],
        "2026-06-02": [{ id: "q1", kind: "opening", text: "?" }],
      },
      manifestWith([{ date: "2026-06-01", answered: ["open:2026-06-01", "after:2026-06-01"] }]),
    );

    expect(container!.textContent).toContain("Tell me about Tuesday");
    expect(container!.textContent).toContain("Any order you like");
  });

  test("says something true instead of naming a day that does not exist, once every real day is told", async () => {
    await render(
      [{ date: "2026-06-01", photoIds: ["p1"], undated: false }],
      { "2026-06-01": [] },
      manifestWith([{ date: "2026-06-01", answered: ["open:2026-06-01", "after:2026-06-01"] }]),
    );

    expect(container!.textContent).not.toContain("Tell me about");
    expect(container!.textContent).toContain("Every day is told.");
  });

  // B2081 — once every day is told the way on is a real primary in the bar,
  // and "Done for now" is only a text link beside it.
  test("every day told puts See what we made in the bar as the one primary", async () => {
    await render(
      [{ date: "2026-06-01", photoIds: ["p1"], undated: false }],
      { "2026-06-01": [] },
      manifestWith([{ date: "2026-06-01", answered: ["open:2026-06-01", "after:2026-06-01"] }]),
    );
    const buttons = Array.from(container!.querySelectorAll("button"));
    const primary = buttons.find((b) => b.textContent === "See what we made");
    expect(primary?.className).toContain("bg-action-strong");
    const leave = buttons.find((b) => b.textContent === "Done for now");
    expect(leave?.className).toContain("underline");
    expect(leave?.className).not.toContain("rounded-full");
  });

  test("a day's open questions come one at a time: one card, the rest named in a list", async () => {
    await render(
      [{ date: "2026-06-02", photoIds: ["p2"], undated: false }],
      {
        "2026-06-02": [
          { id: "open:2026-06-02", kind: "opening", text: "What were you doing?" },
          { id: "where:2026-06-02", kind: "gap", fills: "location", text: "Where were you?" },
          { id: "after:2026-06-02", kind: "follow-up", text: "What happened right after this?" },
        ],
      },
      manifestWith([]),
    );
    await act(async () => {
      container!.querySelector("button[aria-expanded]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const later = container!.querySelector('[data-testid="later-questions"]');
    expect(Array.from(later!.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "Where were you?",
      "What happened right after this?",
    ]);
    // One progress strip for the one open card, not three.
    expect(container!.textContent!.match(/Day 1 of 1/gi) ?? []).toHaveLength(1);
  });

  test("with a day still untold there is no See what we made", async () => {
    await render(
      [{ date: "2026-06-02", photoIds: ["p2"], undated: false }],
      { "2026-06-02": [{ id: "q1", kind: "opening", text: "?" }] },
      manifestWith([]),
    );
    expect(container!.textContent).not.toContain("See what we made");
    expect(container!.textContent).toContain("Done for now");
  });

  // B1835: the undated card is excluded from `nextDayToTell` because it has
  // no weekday to name, not because it is done — so once every real day is
  // told but the undated card still has an open question, the fallback must
  // not claim "Every day is told."
  test("does not say every day is told when only the undated card still has questions", async () => {
    await render(
      [
        { date: "2026-06-01", photoIds: ["p1"], undated: false },
        { date: "", photoIds: ["p2"], undated: true },
      ],
      {
        "2026-06-01": [],
        undated: [{ id: "q1", kind: "opening", text: "?" }],
      },
      manifestWith([{ date: "2026-06-01", answered: ["open:2026-06-01", "after:2026-06-01"] }]),
    );

    expect(container!.textContent).not.toContain("Every day is told.");
    expect(container!.textContent).toContain("Tell me about the photographs with no date");
  });

  // B2110 — the yellow suggestion points at a card; once that card is open it
  // has nothing left to point at.
  test("hides Tell me about <day> while that day's card is open", async () => {
    await render(
      [{ date: "2026-06-02", photoIds: ["p2"], undated: false }],
      { "2026-06-02": [{ id: "q1", kind: "opening", text: "?" }] },
      manifestWith([]),
    );
    const tell = () => Array.from(container!.querySelectorAll("button")).find((b) => b.textContent === "Tell me about Tuesday");
    await act(async () => tell()!.click());
    expect(tell()).toBeUndefined();
    await act(async () => {
      container!.querySelector("button[aria-expanded]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(tell()).toBeDefined();
  });
});
