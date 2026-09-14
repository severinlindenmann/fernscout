import path from "node:path";
import { describe, expect, test } from "vitest";
import { getRoadmap, getTask, getTasks } from "@/lib/roadmap";

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

/**
 * B1721 — the board draws a card's whole shape from `complexity` and sorts
 * Done by `date`, so both being carried is load-bearing rather than
 * decorative. `getTask()` is the second door onto the same tree and needs the
 * same `type: SECURITY` guard as the first.
 */
describe("getTasks()", () => {
  test("carries complexity, a date and a repository path", () => {
    const done = getTasks(FIXTURE_ROOT).find((t) => t.id === "BC02")!;
    expect(done.complexity).toBe("low");
    expect(done.date).toBe("2026-09-01T00:00:00Z");
    expect(done.lane).toBe("completed");
    expect(done.path).toContain("test/fixtures/roadmap-tasks/completed/");
  });

  test("marks backlog/superseded/ and backlog/wont-do/ shelved, and nothing else", () => {
    const tasks = getTasks(FIXTURE_ROOT);
    expect(tasks.find((t) => t.id === "BC04")?.shelved).toBe(true);
    expect(tasks.find((t) => t.id === "BC01")?.shelved).toBe(false);
    expect(tasks.find((t) => t.id === "BC02")?.shelved).toBe(false);
  });

  test("leaves complexity empty rather than guessing when the field is absent", () => {
    const nosize = getTasks(FIXTURE_ROOT).find((t) => t.id === "BC03")!;
    expect(nosize.complexity).toBe("");
  });
});

describe("getTask()", () => {
  test("returns the ticket with its body", () => {
    const task = getTask("BC01", FIXTURE_ROOT);
    expect(task?.title).toBe("An ordinary chore, nothing sensitive");
    expect(task?.body).toBe("Body.");
  });

  test("refuses a type: SECURITY ticket in every lane, folder or not", () => {
    // The same three the board filters: BS01 under backlog/security/, BS02 in
    // completed/ and BS03 in testing/ with no folder to give them away.
    expect(getTask("BS01", FIXTURE_ROOT)).toBeNull();
    expect(getTask("BS02", FIXTURE_ROOT)).toBeNull();
    expect(getTask("BS03", FIXTURE_ROOT)).toBeNull();
  });

  test("answers null for an unknown id, an unparseable file and a path attempt alike", () => {
    expect(getTask("BZ99", FIXTURE_ROOT)).toBeNull();
    expect(getTask("BB01", FIXTURE_ROOT)).toBeNull();
    expect(getTask("../../../etc/passwd", FIXTURE_ROOT)).toBeNull();
  });
});
