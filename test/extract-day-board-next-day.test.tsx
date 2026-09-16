// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import DayBoard from "@/components/extract/DayBoard";
import LocaleProvider from "@/components/LocaleProvider";
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
      if (url.includes("/extract/run")) {
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
        <DayBoard username="alex" runId="run-1" consentedSpeech={false} speechProvider="none" onLeave={() => {}} />
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
});
