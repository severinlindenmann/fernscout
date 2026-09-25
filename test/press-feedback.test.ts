import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B2323 — the touch press-feedback rule (`app/globals.css`) exists to give a
 * phone, which has no hover, some visible answer to a tap. Two ways that
 * could silently regress: the rule leaking onto a mouse (it would then fight
 * the 309 `hover:` rules with a scale nobody asked for), and the scale
 * surviving `prefers-reduced-motion: reduce` (which must keep the brightness
 * change but drop the transform). This is a string check on the source, not
 * a browser — see the worktree's browser captures for the actual computed
 * style during `:active`.
 */

const CSS = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

// The whole press-feedback feature, isolated by its own `@media (hover: none)`
// block so a later edit elsewhere in the file cannot be mistaken for it.
const PRESS_BLOCK_MATCH = CSS.match(
  /\/\*\s*\n \* Touch press feedback[\s\S]*?\n@media \(hover: none\) \{[\s\S]*?\n\}\n/,
);

describe("touch press feedback (B2323)", () => {
  test("the press rule exists and stays inside `hover: none`", () => {
    expect(PRESS_BLOCK_MATCH).not.toBeNull();
    const block = PRESS_BLOCK_MATCH![0];
    // Every `transform: scale(` and `:active` declaration in the feature
    // must sit textually inside the single `@media (hover: none)` wrapper —
    // not a second, unguarded copy elsewhere that a mouse would also see.
    const outsideBlock = CSS.replace(block, "");
    expect(outsideBlock).not.toMatch(/scale\(0\.965\)/);
  });

  test("reduced motion drops the transform but keeps the brightness feedback", () => {
    const block = PRESS_BLOCK_MATCH![0];
    const reducedMotionSplit = block.split("@media (prefers-reduced-motion: no-preference)");
    expect(reducedMotionSplit.length).toBe(2);
    const [beforeReducedMotion, reducedMotionGuarded] = reducedMotionSplit;
    // The scale only ever appears inside the no-preference-guarded half.
    expect(beforeReducedMotion).not.toMatch(/transform:\s*scale/);
    expect(reducedMotionGuarded).toMatch(/transform:\s*scale\(0\.965\)/);
    // The brightness change is unconditional — outside that guard.
    expect(beforeReducedMotion).toMatch(/filter:\s*brightness\(0\.94\)/);
  });

  test("motion tokens are defined once, on :root", () => {
    const rootBlocks = CSS.match(/--ease-out:/g) ?? [];
    expect(rootBlocks.length).toBe(1);
    expect(CSS).toMatch(/--ease-out: cubic-bezier\(0\.22, 1, 0\.36, 1\);/);
    expect(CSS).toMatch(/--ease-ios: cubic-bezier\(0\.32, 0\.72, 0, 1\);/);
    expect(CSS).toMatch(/--dur-press-in: 70ms;/);
    expect(CSS).toMatch(/--dur-press-out: 220ms;/);
    expect(CSS).toMatch(/--dur-move: 380ms;/);
  });
});
