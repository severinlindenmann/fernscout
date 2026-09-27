import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B2467 — overview → day used to push like an iPhone page (B2326): the
 * overview drifted 28% left under a shade while the day slid in over it,
 * which reads as "the overview never left" because a day is not a detail
 * of the overview. Every other move (day → day) already used a clean
 * sequential fade — `AnimatePresence mode="wait"` in `StoryPager`, keyed on
 * `stepIndex`. D5 (decided): overview↔day now uses that same fade, so the
 * push branch is never taken, and its dead CSS/JS is gone rather than
 * merely unreachable.
 */

const root = path.join(__dirname, "..");
const tripStory = fs.readFileSync(path.join(root, "app/TripStory.tsx"), "utf8");
const globals = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
const storyPager = fs.readFileSync(path.join(root, "components/StoryPager.tsx"), "utf8");

describe("overview → day uses the same fade as day → day", () => {
  test("moveTo no longer branches into a view-transition push", () => {
    expect(tripStory).not.toContain("startViewTransition");
    expect(tripStory).not.toContain("data-page-nav");
    expect(tripStory).not.toContain("dataset.pageNav");
    expect(tripStory).not.toContain("fs-story-page");
  });

  test("the push's CSS (data-page-nav, the push/pop keyframes) is deleted, not just unreachable", () => {
    expect(globals).not.toContain("data-page-nav");
    expect(globals).not.toContain("fs-push-in");
    expect(globals).not.toContain("fs-push-under");
    expect(globals).not.toContain("fs-pop-out");
    expect(globals).not.toContain("fs-pop-under");
  });

  test("StoryPager's single crossfade — AnimatePresence mode=\"wait\", keyed on stepIndex — now covers every move, overview included", () => {
    expect(storyPager).toContain('mode="wait"');
    expect(storyPager).toContain("key={stepIndex}");
  });
});
