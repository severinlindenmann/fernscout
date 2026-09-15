// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import ResumeScreen, { type RunSummaryClient } from "@/components/extract/ResumeScreen";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The rendered countdown string — B1805, R1's review finding.
 *
 * `countdownFor` in `lib/staging/countdown.ts` is tested against its own
 * tier data (`test/staging-countdown.test.ts`); this is the one that
 * catches what `ResumeScreen`'s own `describe()` does with a tier once it
 * has one — specifically that `{ unit: "days", days: 0, hours: 3 }` (a real,
 * reachable tier: anything from 3 to 24 hours out) must never render as
 * "0 days, 3 hours left". A fix round pushed the days part unconditionally
 * and only guarded hours, so this asserts on the rendered text rather than
 * on the tier object, which is exactly what let that ship.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const RUN_BASE = {
  version: 1 as const,
  runId: "run-1",
  owner: "alex",
  createdAt: "2026-08-30T00:00:00.000Z",
  tripId: null,
  mode: "type" as const,
  state: "telling" as const,
  photos: [{ id: "p1", filename: "p1.jpg", bytes: 1, kind: "image" as const }],
  days: [],
  daysLeftToTell: 1,
};

function render(run: RunSummaryClient) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <ResumeScreen
          username="alex"
          runs={[run]}
          onContinue={() => {}}
          onStartNew={() => {}}
          onDestroyed={() => {}}
        />
      </LocaleProvider>,
    );
  });
  return container.textContent ?? "";
}

describe("the resume screen's rendered countdown", () => {
  test("3 to 24 hours out reads as hours only, never '0 days'", () => {
    // 3h5m out: days = 0, hours = 3 — the exact tier the fix addresses.
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString();
    const text = render({ ...RUN_BASE, expiresAt });
    expect(text).not.toMatch(/0\s*days?/i);
    expect(text).toMatch(/3 hours left/);
  });

  test("a day and change out reads as both days and hours", () => {
    // +30s past the exact boundary, not on it — Date.now() advances a few ms
    // between computing this and the component's own `new Date()`, and
    // landing exactly on an hour boundary makes the test flake on which side
    // of floor() it lands.
    const expiresAt = new Date(Date.now() + 26 * 60 * 60 * 1000 + 30 * 1000).toISOString();
    const text = render({ ...RUN_BASE, expiresAt });
    expect(text).toMatch(/1 day and 2 hours left/);
  });

  test("exactly one day out reads as a day, with no dangling '0 hours'", () => {
    // Same margin, same reason — see above.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 1000).toISOString();
    const text = render({ ...RUN_BASE, expiresAt });
    expect(text).toMatch(/1 day left/);
    expect(text).not.toMatch(/0\s*hours?/i);
  });
});
