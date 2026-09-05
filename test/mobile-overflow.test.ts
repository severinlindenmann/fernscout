import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B431 — the page must not be able to grow wider than the phone.
 *
 * This is a layout property and jsdom does not lay anything out, so these are
 * source assertions rather than measurements. They are still worth having: the
 * bug was invisible in review, cost a sideways scroll and a clipped right edge
 * on every paragraph of the most-visited page, and the fix is two class names
 * that look like tidying and will be "cleaned up" by somebody who does not
 * know what they are for.
 *
 * The mechanism, so the next reader does not have to rediscover it: `body` is
 * a column flex container, so `main` is a flex item, and a flex item's default
 * `min-width: auto` refuses to shrink below its min-content width. An
 * unbreakable string — the instruction's `https://<site>/documentation.txt` —
 * therefore sets a floor under the width of the entire document. Wrapping the
 * *rendered* line does not lower that floor; only a wrapping mode that
 * contributes to min-content sizing does.
 */

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("the page cannot be widened by one long string", () => {
  test("the body's flex items are allowed to shrink", () => {
    const layout = read("app/layout.tsx");
    const body = /<body className="([^"]+)"/.exec(layout)?.[1] ?? "";
    expect(body).toContain("flex");
    // Without this, `min-width: auto` makes every child's min-content width a
    // floor under the whole document.
    expect(body).toContain("min-w-0");
  });

  test("the agent instruction wraps in the mode that lowers min-content width", () => {
    const sections = read("components/LandingSections.tsx");
    expect(sections).toContain("[overflow-wrap:anywhere]");
    /**
     * `break-words` is `overflow-wrap: break-word`, which wraps the rendered
     * line and leaves min-content width at the full length of the URL. It is
     * the exact class this block used when the bug was filed, so its absence
     * here is the regression guard.
     */
    expect(sections).not.toMatch(/className="[^"]*\bbreak-words\b/);
  });
});
