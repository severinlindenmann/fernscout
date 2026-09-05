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

  /** Closing a card is not saying never. Treating it as never would be putting
   * words in the reader's mouth. */
  test("the dismiss cross snoozes rather than silencing for good", () => {
    const src = read("components/PushPrompt.tsx");
    const cross = src.slice(src.indexOf("aria-label={t(\"push.prompt.notNow\")}") - 300);
    expect(cross.slice(0, 400)).toContain("onClick={notNow}");
  });
});

describe("when and where it appears", () => {
  /** A timer alone would fire at somebody who opened a tab and walked away —
   * the reader least likely to want a prompt waiting for them. */
  test("it waits for dwell time and for something the reader did", () => {
    const src = read("components/PushPrompt.tsx");
    expect(src).toMatch(/DWELL_MS\s*=\s*[\d_]+/);
    expect(src).toContain("acted");
    expect(src).toContain("visibilityState");
  });

  test("an iPhone that has not installed the app gets the explainer instead", () => {
    expect(read("components/PushPrompt.tsx")).toContain("needsHomeScreenInstall()");
  });

  /** The hero renders on the story's landing step alone, so mounting there
   * would ask only the readers who have not started reading — the opposite of
   * the chosen timing. */
  test("it is mounted for the whole journal, not one page of it", () => {
    expect(read("app/[user]/layout.tsx")).toContain("<PushPrompt username={username} />");
  });

  test("every language carries its words", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    for (const locale of ["en", "de", "hu"]) {
      for (const key of ["title", "body", "yes", "notNow", "never"]) {
        expect(dictionaryFor(locale)[`push.prompt.${key}`], `${locale} ${key}`).toBeTruthy();
      }
    }
  });
});
