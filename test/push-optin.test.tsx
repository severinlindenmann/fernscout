import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B438 and B439 — why the switch was not there.
 *
 * A reader with the PWA installed, signed in, on a journal with push enabled,
 * saw nothing at all and had nothing to read about why. Two separate causes,
 * and both fail silently, which is what made it worth two tickets rather than
 * a shrug:
 *
 * - **B438**: `getRegistration()` was sampled once, at hydration, while the
 *   registrar defers `register()` to the window `load` event. Losing that race
 *   set `unsupported`, which renders `null` and is never re-checked.
 * - **B439**: the only mount was inside `TripHero`, which `TripStory` renders
 *   on the story's landing step alone — so it is gone the moment somebody
 *   pages into a day, and a reader who resumed where they left off never met
 *   it.
 *
 * jsdom has no service worker and no push manager, so these are source
 * assertions. They are worth keeping anyway: both regressions would be
 * invisible in review and invisible in the browser, which is the combination
 * that cost this a day.
 */

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("deciding whether push can be offered", () => {
  test("waits for the worker rather than sampling it once", () => {
    const src = read("components/PushOptIn.tsx");
    // The registrar registers on `load`; this component mounts at hydration.
    expect(src).toContain("navigator.serviceWorker.ready");
    expect(src).toContain("WORKER_WAIT_MS");
  });

  /**
   * `.ready` never rejects and never settles when nothing is ever registered —
   * a development build, exactly — so waiting on it alone would replace an
   * invisible control with a permanently invisible one.
   */
  test("the wait is bounded, so it cannot hang on a build with no worker", () => {
    const src = read("components/PushOptIn.tsx");
    expect(src).toMatch(/Promise\.race\(/);
    expect(src).toMatch(/WORKER_WAIT_MS\s*=\s*\d+/);
  });
});

describe("where notifications can be switched on", () => {
  test("the control accepts a journal, so it can mount without a trip", () => {
    const src = read("components/PushOptIn.tsx");
    expect(src).toMatch(/journal\?:\s*string/);
    // A subscription has only ever been per journal; the trip context was how
    // this found a username, not something it needed.
    expect(src).toContain("journal ?? trip?.trip.username");
  });

  test("the reader's own page offers it, not only a trip's hero", () => {
    const me = read("app/[user]/me/MePageContent.tsx");
    expect(me).toContain("<PushOptIn");
    expect(me).toContain("me.notifyTitle");
  });

  /**
   * B448 — the heading belongs to the control, not to the page around it.
   *
   * The page cannot know whether push can work in this browser; the component
   * can, and used to answer `null` under a heading the page had already
   * written. The words are a prop now, so a section that cannot be offered is
   * absent whole. `test/access-panel.test.tsx` is where that is rendered and
   * asserted; this pins the wiring, which is what a later edit would undo.
   */
  test("the page hands over the words rather than writing them around it", () => {
    const me = read("app/[user]/me/MePageContent.tsx");
    expect(me).toMatch(/heading=\{\{\s*title: t\("me\.notifyTitle"\)/);
    // No section element of the page's own around it — that was the bug.
    expect(me).not.toMatch(/<section[^>]*>\s*<h2[^>]*>\s*\{t\("me\.notifyTitle"\)/);
    expect(read("components/PushOptIn.tsx")).toContain("heading?: { title: string; lede: string }");
  });

  test("the hero still offers it, for somebody who meets it there first", () => {
    expect(read("components/TripHero.tsx")).toContain("<PushOptIn />");
  });

  test("every language carries the new section's words", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    for (const locale of ["en", "de", "hu"]) {
      expect(dictionaryFor(locale)["me.notifyTitle"]).toBeTruthy();
      expect(dictionaryFor(locale)["me.notifyLede"]).toBeTruthy();
    }
  });
});
