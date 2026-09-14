import fs from "node:fs";
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

/**
 * B1721, found on the live instance after the first deploy: one visit to the
 * board fetched 103 distinct ticket pages in 247 requests. Next prefetches a
 * `<Link>` when it enters the viewport, there are a hundred links on that
 * page, and every one of those prefetches is a server render that walks all
 * ~1,600 task files. Nobody reads a hundred tickets; they click one.
 *
 * A source scan rather than a render test, for the same reason
 * `test/contrast.test.ts` is one: the failure is a link somebody adds later
 * without the prop, and no rendered assertion about today's links would catch
 * it.
 */
describe("the roadmap pages never prefetch", () => {
  const files = ["app/docs/roadmap/page.tsx", "app/docs/roadmap/[id]/page.tsx"];

  /**
   * Every `<Link ...>` opening tag in the source.
   *
   * Scanned rather than matched with one regular expression, and not for
   * neatness: the first version of this test was
   * `/<Link\s[\s\S]{0,400}?>/g`, and the card's own link — the one with the
   * long template-literal `className`, and the one that is repeated forty
   * times on the page — is longer than four hundred characters. It was the
   * only link the scan missed, and deleting its `prefetch={false}` left the
   * test green. A cap that silently drops the biggest tag is worse than no
   * test, because it reads as coverage.
   *
   * `>` appears inside a `className` and inside a `{}` expression, so depth
   * and quoting decide where the tag ends.
   */
  function linkTags(source: string): string[] {
    const tags: string[] = [];
    for (let i = source.indexOf("<Link"); i !== -1; i = source.indexOf("<Link", i + 1)) {
      if (!/\s/.test(source[i + 5] ?? "")) continue; // <LinkThing, and `<Link>` in a comment
      let depth = 0;
      let quote = "";
      for (let j = i + 5; j < source.length; j++) {
        const c = source[j];
        if (quote) {
          if (c === quote && source[j - 1] !== "\\") quote = "";
          continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) {
          tags.push(source.slice(i, j + 1));
          break;
        }
      }
    }
    return tags;
  }

  test("the scan finds the long card link, which a length-capped regex did not", () => {
    const tags = linkTags(fs.readFileSync(path.join(process.cwd(), files[0]), "utf8"));
    // The card's link is the one the first version of this test missed. If it
    // ever gets shorter than this, the test below is still correct — but the
    // reason this scanner exists has gone, and that is worth noticing.
    expect(tags.some((t) => t.length > 400)).toBe(true);
    expect(tags.every((t) => t.endsWith(">"))).toBe(true);
  });

  test("every <Link> carries prefetch={false}", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const tag of linkTags(source)) {
        if (!tag.includes("prefetch={false}")) {
          offenders.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
