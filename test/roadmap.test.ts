import path from "node:path";
import { describe, expect, test } from "vitest";
import { getRoadmap } from "@/lib/roadmap";

/**
 * B675 — the trap this ticket is entirely about: `scripts/tasks.mjs` only
 * files tasks into category folders (`security/`, `chore/`, …) *within*
 * `backlog/`. Every other lane is flat, so a `type: SECURITY` ticket that has
 * moved to `testing/` or `completed/` sits at that lane's top level with no
 * `security` path segment at all — a filter on the folder alone would
 * publish it. This test is against a fixture tree rather than the live one:
 * the live tree changes hourly and a test must not depend on today's shape
 * of `docs/tasks/`.
 */
const FIXTURE_ROOT = path.join(process.cwd(), "test", "fixtures", "roadmap-tasks");

describe("getRoadmap()", () => {
  test("never returns a type: SECURITY ticket, in any lane", () => {
    const lanes = getRoadmap(FIXTURE_ROOT);
    const ids = lanes.flatMap((l) => l.tasks.map((t) => t.id));
    // BS01 sits in backlog/security/, BS02 in completed/ with no folder at
    // all, BS03 in testing/ likewise — all three are type: SECURITY.
    expect(ids).not.toContain("BS01");
    expect(ids).not.toContain("BS02");
    expect(ids).not.toContain("BS03");
  });

  test("keeps an ordinary ticket in the lane it sits in", () => {
    const lanes = getRoadmap(FIXTURE_ROOT);
    const backlog = lanes.find((l) => l.lane === "backlog")!;
    const completed = lanes.find((l) => l.lane === "completed")!;
    expect(backlog.tasks.map((t) => t.id)).toContain("BC01");
    expect(completed.tasks.map((t) => t.id)).toContain("BC02");
  });

  test("skips a file whose frontmatter fails to parse, rather than throwing", () => {
    // BB01's title has an unquoted colon-space, which is invalid YAML for
    // gray-matter to parse as a plain scalar — a real shape found in this
    // repository's own docs/tasks/.
    expect(() => getRoadmap(FIXTURE_ROOT)).not.toThrow();
    const lanes = getRoadmap(FIXTURE_ROOT);
    const open = lanes.find((l) => l.lane === "open")!;
    expect(open.tasks.map((t) => t.id)).not.toContain("BB01");
  });

  test("returns empty lanes rather than throwing when docs/tasks/ is absent", () => {
    const lanes = getRoadmap(path.join(FIXTURE_ROOT, "does-not-exist"));
    expect(lanes).toEqual([]);
  });
});
