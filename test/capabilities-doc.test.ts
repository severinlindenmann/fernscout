import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { applyToDoc, buildFeatureTable } from "../scripts/build-capabilities-doc.mts";

/**
 * The feature table in docs/capabilities.md is generated from `FEATURE_NAMES`,
 * `OPERATOR_ONLY_FEATURES` (lib/config.ts) and `PAID_FEATURES`
 * (lib/capabilities.ts) rather than hand-written, because the hand-written
 * version drifted — it called `signup` a per-journal switch when it has no
 * switch at all, and said "off by default" for capabilities that are
 * actually operator-only.
 *
 * This fails the same way `npm run i18n:keys` would if somebody edited the
 * generated union by hand: run `npx tsx --conditions=react-server
 * scripts/build-capabilities-doc.mts` and commit the result.
 */
test("docs/capabilities.md's generated feature table matches the code", () => {
  const file = path.join(process.cwd(), "docs", "capabilities.md");
  const committed = fs.readFileSync(file, "utf8");
  expect(applyToDoc(committed)).toBe(committed);
});

describe("generated table", () => {
  test("every FEATURE_NAMES entry appears exactly once", async () => {
    const { FEATURE_NAMES } = await import("../lib/config");
    const table = buildFeatureTable();
    for (const name of FEATURE_NAMES) {
      const count = table.split(`\`${name}\` |`).length - 1;
      expect(count, `${name} should appear once in the generated table`).toBe(1);
    }
  });
});
