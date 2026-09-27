import { expect, test } from "vitest";

// Throwaway: proves a PR with a red test is not auto-merged (delivery-flow run, 27 Sep). Never merged.
test("deliberately red", () => {
  expect(1).toBe(2);
});
