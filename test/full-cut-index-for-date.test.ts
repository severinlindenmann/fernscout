import { describe, expect, test } from "vitest";
import { fullCutIndexForDate } from "@/components/SlideShow";

/**
 * B2306 — where the "every photo" cut and the day strip land when a reader
 * (or a day page's own slideshow button) asks for a calendar day. Only
 * `kind` and `date` matter to the function; everything else a real `FullStep`
 * carries is irrelevant here, so the fixtures below carry only those two.
 */
type Step = { kind: "travel" | "media"; date?: string };

function step(kind: Step["kind"], date?: string): Step {
  return { kind, date };
}

const steps = [
  step("travel"), // 0 — arriving at the first place
  step("media", "2024-09-10"), // 1
  step("media", "2024-09-10"), // 2
  step("travel"), // 3 — leaving for the next place
  step("media", "2024-09-12"), // 4 — the 11th has no photos at all
];

describe("fullCutIndexForDate", () => {
  test("lands on the first step of an exact day", () => {
    expect(fullCutIndexForDate(steps as never, "2024-09-10")).toBe(1);
  });

  test("a day with no photo of its own lands on the next photographed day", () => {
    expect(fullCutIndexForDate(steps as never, "2024-09-11")).toBe(4);
  });

  test("past the last photographed day clamps to the last step", () => {
    expect(fullCutIndexForDate(steps as never, "2024-09-20")).toBe(steps.length - 1);
  });

  test("an empty cut clamps to 0 rather than going negative", () => {
    expect(fullCutIndexForDate([] as never, "2024-09-10")).toBe(0);
  });
});
