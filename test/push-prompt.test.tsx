import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B440 — the soft ask, and the line it must never cross.
 *
 * A prompt that offers notifications is one bad line away from being the thing
 * browsers penalise origins for. jsdom has no PushManager and no permission
 * model, so the assertions that matter here are about the *source*: they pin
 * the rules, and the rules are the whole design.
 *
 * The one that would be a real harm if it regressed is the first. A denied
 * browser permission is close to permanent — undoing it means a buried
 * settings screen, which for the reader this feature is written for means
 * never — so the browser's own prompt may only ever appear behind a press.
 */

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

/**
 * The file with its prose removed.
 *
 * These tests assert on what the code *does*, and this component's own comment
 * names the API it must never call — twice, because the reason is the point of
 * the file. Matching the raw text failed on the explanation rather than on a
 * call, which is a test that punishes documenting the rule.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("the prompt never fires the browser's own permission dialog", () => {
  test("it does not call requestPermission itself", () => {
    // The real prompt lives in `subscribeToPush`, reached only from `accept`.
    expect(code("components/PushPrompt.tsx")).not.toContain("Notification.requestPermission");
  });

  /** And exactly one place in the codebase does call it. */
  test("only the shared module asks the browser", () => {
    const callers = ["components/PushPrompt.tsx", "components/PushOptIn.tsx"];
    for (const file of callers) {
      expect(code(file), file).not.toContain("Notification.requestPermission");
    }
    expect(code("components/pushSubscribe.ts")).toContain("Notification.requestPermission");
  });

  test("the press is what reaches it, through the shared module", () => {
    const src = read("components/PushPrompt.tsx");
    expect(src).toContain("subscribeToPush");
    expect(src).toMatch(/onClick=\{accept\}/);
  });

  /** Both controls press the same code as the bell, so the two cannot drift
   * apart on encoding, on the request body, or on the gesture rule. */
  test("the bell presses the same module", () => {
    expect(read("components/PushOptIn.tsx")).toContain("subscribeToPush");
  });

  test("a permission already answered is never asked about again", () => {
    const src = read("components/PushPrompt.tsx");
    expect(src).toContain('Notification.permission !== "default"');
  });
});

describe("what a no means", () => {
  test("there are two of them, and they last different lengths", () => {
    const src = read("components/PushPrompt.tsx");
    expect(src).toContain("fs.push.never");
    expect(src).toContain("fs.push.snooze.");
    expect(src).toMatch(/SNOOZE_DAYS\s*=\s*\d+/);
  });

  /**
   * A denial is the strongest no the platform offers. Asking again after one
   * would be asking somebody to go into settings, so it writes the global key
   * exactly as pressing "never" does.
   */
  test("a browser denial is treated as never, everywhere", () => {
    const src = read("components/PushPrompt.tsx");
    const denials = src.match(/=== "denied"[\s\S]{0,120}NEVER_KEY/g) ?? [];
    // Once when deciding whether to show, once when the press comes back.
    expect(denials.length).toBeGreaterThanOrEqual(2);
  });

  /** "Not now" is the only dismiss on the card itself since B2464 — "Don't
   * ask again" moved to `/me` (`NeverAskNextDay.tsx`), a settings switch
   * rather than a button on a card the reader may only ever see once. It
   * still only snoozes, never silences for good. */
  test("the card's only dismiss snoozes rather than silencing for good", () => {
    const src = read("components/PushPrompt.tsx");
    expect(src).not.toContain('t("push.prompt.never")');
    const i = src.indexOf('t("push.prompt.notNow")');
    const around = src.slice(Math.max(0, i - 300), i + 100);
    expect(around).toContain("onClick={notNow}");
  });

  test("'Don't ask again' lives on /me, beside the push switch, as a reversible toggle", () => {
    const toggle = read("components/NeverAskNextDay.tsx");
    expect(toggle).toContain("NEVER_KEY");
    expect(toggle).toContain('t("push.prompt.never")');
    const me = read("app/[user]/me/MePageContent.tsx");
    expect(me).toMatch(/<PushOptIn[\s\S]{0,400}<NeverAskNextDay/);
  });
});

describe("when and where it appears", () => {
  /** A timer alone would fire at somebody who opened a tab and walked away —
   * the reader least likely to want a prompt waiting for them. */
  test("it waits for dwell time and for something the reader did", () => {
    // The rule lives in `components/useEngagement.ts` since B1718, which
    // lifted it out of this component so the showcase bar could ask the same
    // question the same way. The assertion is unchanged; only its address is.
    const src = read("components/useEngagement.ts");
    expect(src).toMatch(/DWELL_MS\s*=\s*[\d_]+/);
    expect(src).toContain("acted");
    expect(src).toContain("visibilityState");
    // And this component still uses it rather than a rule of its own.
    expect(read("components/PushPrompt.tsx")).toContain("useEngagement()");
  });

  test("an iPhone that has not installed the app gets the explainer instead", () => {
    expect(read("components/PushPrompt.tsx")).toContain("needsHomeScreenInstall()");
  });

  /**
   * B2464 — the card used to hang after every page's content in the layout,
   * disconnected from anything the reader had just done, and repeated the
   * notification section `/me` already has. It now renders once, inside the
   * day it makes sense on.
   */
  test("it is gone from the layout", () => {
    expect(read("app/[user]/layout.tsx")).not.toContain("<PushPrompt");
  });

  test("it renders inside the day reader, gated on the newest day of a trip still going", () => {
    const src = read("components/StoryPager.tsx");
    expect(src).toContain("<PushPrompt");
    expect(src).toContain("isNewestDay");
    // "Still going" — a finished trip has no next day to want.
    expect(src).toMatch(/trip\.trip\.status\s*!==\s*"past"/);
    // Not on a draft: a reader is never the newest *published* day's audience
    // if the last thing written is not published yet.
    expect(src).toMatch(/!lead\.draft/);
    // Never on the operator's own showcase journal — B1724's guarantee that a
    // showcase reader is asked one thing, not two, still holds here.
    expect(src).toMatch(/!site\??\.isShowcase|!isShowcase/);
  });

  test("StoryPager is the only place that renders it — not /me, not the trips list, not the overview step", () => {
    function files(dir: string): string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return files(full);
        return /\.tsx?$/.test(e.name) ? [full] : [];
      });
    }
    const root = process.cwd();
    const candidates = [...files(path.join(root, "app")), ...files(path.join(root, "components"))];
    const renderers = candidates.filter(
      (f) => f !== path.join(root, "components/PushPrompt.tsx") && /<PushPrompt\b/.test(fs.readFileSync(f, "utf8")),
    );
    expect(renderers.map((f) => path.relative(root, f))).toEqual(["components/StoryPager.tsx"]);
  });

  test("every language carries its words", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    for (const locale of ["en", "de", "hu"]) {
      for (const key of ["title", "body", "yes", "notNow", "never", "wantDay"]) {
        expect(dictionaryFor(locale)[`push.prompt.${key}`], `${locale} ${key}`).toBeTruthy();
      }
    }
  });
});
