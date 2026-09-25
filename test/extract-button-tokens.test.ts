import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B1802 — the import's five primary buttons paired `bg-ink-strong` (an ink
 * token, which flips with the theme) with `text-white` (a literal, which
 * does not): legible in light, cream-on-cream in dark. The fix is the pair
 * that exists for a filled action button — `bg-action-strong` and
 * `text-on-action` — both of which flip together.
 *
 * This is a static source check, not a rendered-contrast one: it is the
 * fast, exact way to keep the *pairing* from drifting back — see B1798,
 * the same class of mistake, one theme earlier. A real browser capture
 * (test-in-a-browser, dark, 390px) is still what proves the pixels.
 */
const FILES = [
  "components/extract/ResumeScreen.tsx",
  "components/extract/UploadStep.tsx",
  "components/extract/AskCard.tsx",
  "components/extract/PhotoChips.tsx",
];

describe("extract's primary buttons use the action/on-action pair, not ink-strong/white", () => {
  for (const file of FILES) {
    test(file, () => {
      const source = fs.readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
      expect(source).not.toMatch(/text-white/);
      expect(source).not.toMatch(/bg-ink-strong/);
      expect(source).toMatch(/bg-action-strong/);
      expect(source).toMatch(/text-on-action/);
    });
  }
});
