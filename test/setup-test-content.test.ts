import { describe, expect, test } from "vitest";
import { scratchPaths } from "@/scripts/setup-test-content";

describe("scratchPaths", () => {
  test("nests content and the sqlite file under the given base", () => {
    const { contentDir, dbPath } = scratchPaths("/tmp/fernscout-test-content");
    expect(contentDir).toBe("/tmp/fernscout-test-content/content");
    expect(dbPath).toBe("/tmp/fernscout-test-content/fernscout.db");
  });
});
