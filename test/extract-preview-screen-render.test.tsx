// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import PreviewScreen from "@/components/extract/PreviewScreen";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * The run's last screen, rendered — B1751 Task 4.2. Same jsdom + `createRoot`
 * harness as `test/extract-credits-screen.test.tsx`.
 *
 * What this file checks a grep cannot: a finished day actually links to its
 * real page (`/[user]/trips/[trip]/day/[slug]`) rather than to anything this
 * component draws itself, and a run with nothing finished says so honestly
 * instead of showing an empty trip as if it were real.
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
    tripId: null,
    mode: "type",
    state: "telling",
    photos: [],
    days: [],
    ...overrides,
  };
}

function stubRun(manifest: Record<string, unknown>, groups: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/extract/run")) {
        return { ok: true, json: async () => ({ manifest, groups, questions: {} }) } as Response;
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
        <PreviewScreen username="alex" runId="run-1" />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the preview screen", () => {
  test("a finished day links to its own real page, not anything drawn here", async () => {
    stubRun(
      baseManifest({
        tripId: "japan-2026",
        days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "first-day" }],
      }),
      [{ date: "2026-06-01", photoIds: ["p1"], undated: false }],
    );
    await render();

    const link = container!.querySelector('a[href="/alex/trips/japan-2026/day/first-day"]');
    expect(link).not.toBeNull();
    expect(container!.querySelector('a[href="/alex/trips/japan-2026"]')).not.toBeNull();
  });

  test("a run with nothing committed says so, and offers no people form with no trip to add them to", async () => {
    stubRun(baseManifest());
    await render();

    expect(container!.textContent).toContain("None of your days had everything answered");
    expect(container!.querySelector("form")).toBeNull();
  });

  test("a day still carrying open questions is named as skipped, not silently dropped", async () => {
    stubRun(
      baseManifest({
        tripId: "japan-2026",
        days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "first-day" }],
      }),
      [
        { date: "2026-06-01", photoIds: ["p1"], undated: false },
        { date: "2026-06-02", photoIds: ["p2"], undated: false },
      ],
    );
    await render();

    expect(container!.textContent).toContain("One day still has unanswered questions");
  });

  test("the people form is offered once a trip exists", async () => {
    stubRun(
      baseManifest({
        tripId: "japan-2026",
        days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "first-day" }],
      }),
      [{ date: "2026-06-01", photoIds: ["p1"], undated: false }],
    );
    await render();

    expect(container!.querySelector("form")).not.toBeNull();
    expect(container!.querySelector('a[href="/agent"]')).not.toBeNull();
  });
});
