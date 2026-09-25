// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import ExtractFlow from "@/components/extract/ExtractFlow";
import LocaleProvider from "@/components/LocaleProvider";
import StudioBarProvider from "@/components/studio/StudioBar";
import { dictionaryFor } from "@/lib/locales";

/**
 * The resumed-run notice — B1751 Task 4.3, R33's review finding.
 *
 * Same jsdom + `createRoot` harness `paid/test/extract-credits-screen.test.tsx`
 * already uses, rather than adding `@testing-library/react` for one more
 * component.
 *
 * **What this file exists to hold.** A fix round moved the three-sentence
 * expiry notice off `ResumeScreen` and onto `ExtractFlow`'s post-continue
 * screen, and `studio.photos.resume.onlyAdded` — "only the days you added at the last step are in
 * your journal" — was left behind on the list. The brief requires that reassurance
 * in every one of the three states, adjacent to the clock, not a screen
 * earlier. This drives the real flow (list → Continue → the resumed run's
 * own screen) for all three states and asserts both sentences are present,
 * with the reassurance ahead of the clock in document order — written so it
 * fails against the version that dropped the reassurance.
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

const RUN_MANIFEST_BASE = {
  version: 1 as const,
  runId: "run-1",
  owner: "alex",
  createdAt: "2026-08-30T00:00:00.000Z",
  tripId: null,
  mode: "type" as const,
  state: "telling" as const,
  photos: [{ id: "p1", filename: "p1.jpg", bytes: 1, kind: "image" as const }],
  days: [],
};

type Fixture = {
  /** What `GET .../studio/runs` (the pure list) hands back for this run —
   *  the pre-touch state `ResumeScreen`/`continueRun` see. */
  listed: Record<string, unknown>;
  /** What `GET .../studio/run` (which really does call `extendOnTouch`)
   *  hands back once the run is actually opened — the post-touch state. In
   *  real life the server computes this; here it is asserted by hand for
   *  each of the three states, matching what `extendOnTouch` would really
   *  do. */
  loaded: Record<string, unknown>;
  /** A phrase unique to this state's own sentence, present regardless of
   *  which date gets interpolated into it. */
  ownSentence: string;
};

const FIXTURES: Record<"notWarned" | "justExtended" | "extended", Fixture> = {
  notWarned: {
    listed: { ...RUN_MANIFEST_BASE, expiresAt: "2026-09-01T00:00:00.000Z", daysLeftToTell: 1 },
    loaded: { ...RUN_MANIFEST_BASE, expiresAt: "2026-09-01T00:00:00.000Z" },
    ownSentence: "no hurry, but there is a clock",
  },
  justExtended: {
    listed: {
      ...RUN_MANIFEST_BASE,
      warnedAt: "2026-08-31T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z", // pinned to warnedAt + 24h, not yet extended
      daysLeftToTell: 1,
    },
    loaded: {
      ...RUN_MANIFEST_BASE,
      warnedAt: "2026-08-31T00:00:00.000Z",
      extendedAt: "2026-08-31T00:00:01.000Z",
      expiresAt: "2026-09-02T00:00:01.000Z", // extendOnTouch really did move it forward
    },
    ownSentence: "that's the one extension",
  },
  extended: {
    listed: {
      ...RUN_MANIFEST_BASE,
      warnedAt: "2026-08-30T12:00:00.000Z",
      extendedAt: "2026-08-30T12:00:01.000Z",
      expiresAt: "2026-09-01T12:00:01.000Z", // already extended before this visit
      daysLeftToTell: 1,
    },
    loaded: {
      ...RUN_MANIFEST_BASE,
      warnedAt: "2026-08-30T12:00:00.000Z",
      extendedAt: "2026-08-30T12:00:01.000Z",
      expiresAt: "2026-09-01T12:00:01.000Z", // unchanged — no fresh transition
    },
    ownSentence: "there's no further one",
  },
};

function stubResumeFetch(fixture: Fixture) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/studio/runs")) {
        return { ok: true, json: async () => ({ runs: [fixture.listed] }) } as Response;
      }
      if (url.includes("/studio/run?run=")) {
        return {
          ok: true,
          json: async () => ({ manifest: fixture.loaded, groups: [], questions: {} }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function renderResumed(fixture: Fixture) {
  stubResumeFetch(fixture);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <StudioBarProvider username="alex">
        <ExtractFlow username="alex" consentedSpeech={false} speechProvider="none" trips={[]} />
        </StudioBarProvider>
      </LocaleProvider>,
    );
  });
  // Let `checkResume`'s GET .../studio/runs resolve and ResumeScreen mount.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const continueButton = Array.from(container!.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Continue"),
  );
  if (!continueButton) throw new Error("Continue button did not render");
  await act(async () => {
    continueButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // Let DayBoard's own GET .../studio/run resolve and fire onLoaded.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the resumed run's notice carries the reassurance in every state", () => {
  for (const [state, fixture] of Object.entries(FIXTURES) as [keyof typeof FIXTURES, Fixture][]) {
    test(`${state}: the reassurance and the state's own sentence both appear, reassurance first`, async () => {
      await renderResumed(fixture);

      const reassurance = container!.querySelector('[data-testid="resume-notice-reassurance"]');
      const clock = container!.querySelector('[data-testid="resume-notice-clock"]');
      expect(reassurance).not.toBeNull();
      expect(clock).not.toBeNull();

      // The reassurance every state needs — B1751 brief's own "line that
      // matters most". This is exactly what a fix round can silently drop
      // when the notice moves screens; asserting the substring, not merely
      // the element's presence, is what makes that failure visible.
      expect(reassurance!.textContent).toContain("added at the last step are in your journal");
      expect(clock!.textContent).toContain(fixture.ownSentence);

      // DOCUMENT_POSITION_FOLLOWING (4): the clock sentence comes AFTER the
      // reassurance — adjacent, not below a fold or after a control.
      const order = reassurance!.compareDocumentPosition(clock!);
      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }
});
