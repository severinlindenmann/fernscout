import { describe, expect, test } from "vitest";
import { partCommitPlan, titleCollidesWithExisting } from "@/lib/studio/dayCollision";

/**
 * B2676, decision 4 — "Add this to it?" asked inline, and what accepting it
 * means for the part (or parts) that get saved after. Pure logic, no fetch.
 */

describe("titleCollidesWithExisting", () => {
  const existing = { slug: "baths-and-the-bastion", title: "Baths and the bastion", status: "draft" as const };

  test("an empty title never collides — nothing has been typed to compare", () => {
    expect(titleCollidesWithExisting("", existing)).toBe(false);
    expect(titleCollidesWithExisting("   ", existing)).toBe(false);
  });

  test("a title that slugifies to the same address collides", () => {
    expect(titleCollidesWithExisting("Baths and the bastion", existing)).toBe(true);
    // Case and punctuation do not save it: the address is still the same.
    expect(titleCollidesWithExisting("BATHS AND THE BASTION!", existing)).toBe(true);
  });

  test("a different title does not collide", () => {
    expect(titleCollidesWithExisting("A slow afternoon", existing)).toBe(false);
  });
});

describe("partCommitPlan", () => {
  const parts = [{ from: "08:12" }, { from: "14:05" }, { from: null }];

  test("a brand-new day: only later parts are a second entry, each at its own time", () => {
    expect(partCommitPlan(parts, false)).toEqual([
      { index: 0, secondEntry: false, time: "08:12" },
      { index: 1, secondEntry: true, time: "14:05" },
      { index: 2, secondEntry: true, time: "" },
    ]);
  });

  test("\"Yes, add to that day\": every part, including the first, is a second entry", () => {
    expect(partCommitPlan(parts, true)).toEqual([
      { index: 0, secondEntry: true, time: "08:12" },
      { index: 1, secondEntry: true, time: "14:05" },
      { index: 2, secondEntry: true, time: "" },
    ]);
  });

  test("one part, unsplit: the base case still holds", () => {
    expect(partCommitPlan([{ from: "09:00" }], false)).toEqual([{ index: 0, secondEntry: false, time: "09:00" }]);
  });
});
