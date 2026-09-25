import { describe, expect, test } from "vitest";
import { FEATURE_NAMES } from "@/lib/config";
import { isEnabled } from "@/lib/capabilities";

describe("the extract capability", () => {
  test("is a feature name", () => {
    expect(FEATURE_NAMES).toContain("extract");
  });

  test("is off when nothing has enabled it", () => {
    expect(isEnabled("extract", "nobody")).toBe(false);
  });
});
