import { describe, expect, test } from "vitest";
import { FEATURE_NAMES } from "@/lib/config";
import { COVERAGE } from "@/docs/testing/coverage";

/**
 * B-todo: mirrors test/openapi-contract.test.ts's own shape — a constant the
 * document imports rather than retypes, checked against the real enum, so a
 * capability that ships with no way to test it is a build failure rather
 * than a hope. See docs/testing/coverage.ts for what an entry may say.
 */
describe("coverage matrix", () => {
  test("every capability has a coverage entry", () => {
    const missing = FEATURE_NAMES.filter((name) => !(name in COVERAGE));
    expect(missing).toEqual([]);
  });

  test("every entry either names flows or says why it has none yet", () => {
    const bad = FEATURE_NAMES.filter((name) => {
      const entry = COVERAGE[name];
      if (!entry) return true;
      if ("todo" in entry) return typeof entry.todo !== "string" || entry.todo.trim() === "";
      return !Array.isArray(entry.flows) || entry.flows.length === 0;
    });
    expect(bad).toEqual([]);
  });

  test("the matrix names no capability that no longer exists", () => {
    const stale = Object.keys(COVERAGE).filter(
      (name) => !(FEATURE_NAMES as readonly string[]).includes(name),
    );
    expect(stale).toEqual([]);
  });
});
