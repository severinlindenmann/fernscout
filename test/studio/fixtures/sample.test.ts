// A fixture test file for `test/studio/conformance.test.ts` to point the
// `test` proof kind at, so those tests don't have to run the whole suite to
// prove the gate reads vitest's own JSON reporter correctly. Not itself part
// of the studio — it exists only to have one known-passing test with a
// stable full name that `scripts/studio-check.mts` can look up.
import { expect, test } from "vitest";

test("studio-check fixture > this one passes", () => {
  expect(1 + 1).toBe(2);
});
