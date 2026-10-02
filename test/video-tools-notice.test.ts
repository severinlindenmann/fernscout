// @scans test/support/video-tools-notice.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { countSkippedVideoTests } from "./support/video-tools-notice.ts";

/**
 * B2714 — the loud skip line names how many tests vanished, counted from
 * the test files themselves. This is the one runnable check on that
 * counting: a `describe.runIf(await videoToolsAvailable())` block counts
 * every `test()` inside it, an inline `if (!(await videoToolsAvailable()))
 * return;` guard counts one, and a file with neither counts zero.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-video-notice-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Built from parts rather than written as the literal pattern: this file
// lives under test/, so a literal "describe.runIf(await
// videoToolsAvailable())" here would also be matched when the real
// globalSetup scans test/ for guards — a fixture that fakes out the thing
// testing it.
const GUARD_FN = "videoTools" + "Available";

test("counts tests inside a describe.runIf(videoToolsAvailable()) block", () => {
  fs.writeFileSync(
    path.join(dir, "a.test.ts"),
    [
      `describe.runIf(await ${GUARD_FN}())("video", () => {`,
      '  test("one", () => {});',
      '  test("two", () => {});',
      "});",
    ].join("\n"),
  );
  expect(countSkippedVideoTests(dir)).toBe(2);
});

test("counts an inline early-return guard as one test", () => {
  fs.writeFileSync(
    path.join(dir, "b.test.ts"),
    ['test("needs ffmpeg", async () => {', `  if (!(await ${GUARD_FN}())) return;`, "});"].join("\n"),
  );
  expect(countSkippedVideoTests(dir)).toBe(1);
});

test("a file with neither pattern counts zero", () => {
  fs.writeFileSync(path.join(dir, "c.test.ts"), 'test("plain", () => {});');
  expect(countSkippedVideoTests(dir)).toBe(0);
});
