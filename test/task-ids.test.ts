import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The task tree's own ids, checked against the one promise `AGENTS.md` makes
 * about them: **an id means one thing forever.** Tasks reference each other by
 * id and by nothing else — files move between lanes, so a path link breaks and
 * a relative link is forbidden — which leaves the number carrying the whole
 * weight of the reference.
 *
 * Allocation is not enough on its own, and B143 is the record of why. Four
 * agents in four worktrees captured four problems on 2026-09-03 and all four
 * called it B130; the renumbering that followed had to edit the capture *and*
 * the prose in the task that raised it, four times, and one reference survived
 * the first attempt because BSD `sed` treats `\b` as a literal. Nothing in the
 * repository noticed either the collision or the leftover: two files claiming
 * one id have different filenames, so they merge cleanly, and INDEX.md renders
 * both rows without complaint.
 *
 * So the collision is made loud here rather than found by a person reading the
 * index. This runs in `npx vitest run` and in CI, which is to say it runs
 * before a merge can land.
 *
 * These assertions read the checkout they are run in. A worktree sees its own
 * snapshot and main sees the merged result, which is the right way round: the
 * duplicate that matters is the one that exists *after* two branches meet.
 */

const LANES = ["backlog", "open", "in-development", "testing", "completed"];
const ROOT = path.join(process.cwd(), "docs", "tasks");

/**
 * The lanes whose tasks are filed one level down, in a category folder, and
 * the folder each `type` (with `complexity`, for a FEATURE) belongs in. Both
 * are `scripts/tasks.mjs`'s — `CATEGORISED` and `categoryOf()` — restated here
 * rather than imported, because that script is untyped ESM run by node. The
 * last test in this file is what keeps the copy honest: if the script's
 * derivation changes and this one does not, the tree stops matching and the
 * assertion says so by name.
 */
const CATEGORISED = new Set(["backlog", "testing"]);

function categoryFor(type: string, complexity: string, superseded: string): string {
  if (superseded) return "superseded";
  if (type === "SECURITY") return "security";
  if (type === "CHORE") return "chore";
  if (type === "OPS") return "ops";
  if (type === "DOCS") return "docs-and-skills";
  if (type === "FEATURE") return complexity === "high" ? "big-feature" : "small-feature";
  return "issue";
}

type Task = {
  id: string;
  lane: string;
  filed: string;
  filename: string;
  where: string;
  type: string;
  complexity: string;
  superseded: string;
  body: string;
};

const field = (raw: string, key: string) =>
  new RegExp(`^${key}:\\s*["']?(.*?)["']?\\s*$`, "m").exec(raw)?.[1] ?? "";

/**
 * Every task file, at the top of a lane or one category folder down.
 *
 * Both layouts are read, and that matters for the same reason it does in the
 * script: a branch cut before the category folders existed merges its captures
 * straight into the lane root, and a sweep that cannot see them is exactly the
 * duplicate id this file was written to catch, sailing through.
 */
function tasks(): Task[] {
  return LANES.flatMap((lane) => {
    const dir = path.join(ROOT, lane);
    if (!fs.existsSync(dir)) return [];
    const files: { filed: string; file: string; filename: string }[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const filename of fs.readdirSync(path.join(dir, entry.name))) {
          if (filename.endsWith(".md")) {
            files.push({ filed: entry.name, file: path.join(dir, entry.name, filename), filename });
          }
        }
      } else if (entry.name.endsWith(".md")) {
        files.push({ filed: "", file: path.join(dir, entry.name), filename: entry.name });
      }
    }
    return files.map(({ filed, file, filename }) => {
      const raw = fs.readFileSync(file, "utf8");
      return {
        id: field(raw, "id"),
        lane,
        filed,
        filename,
        where: [lane, filed, filename].filter(Boolean).join("/"),
        type: field(raw, "type"),
        complexity: field(raw, "complexity"),
        superseded: field(raw, "superseded"),
        body: raw,
      };
    });
  });
}

describe("task ids", () => {
  const all = tasks();

  test("there are tasks to check", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  test("no id is claimed by two files", () => {
    const where = new Map<string, string[]>();
    for (const task of all) {
      where.set(task.id, [...(where.get(task.id) ?? []), task.where]);
    }
    const duplicates = [...where].filter(([, at]) => at.length > 1);

    // Named in the failure, because the fix is to renumber one of the pair and
    // the reader needs to know which two files disagree.
    expect(duplicates.map(([id, at]) => `${id}: ${at.join(" and ")}`)).toEqual([]);
  });

  test("every file is named for the id in its frontmatter", () => {
    // The renumbering that follows a collision renames the file and rewrites
    // the frontmatter as two separate edits. Half of it is the failure mode.
    const disagreeing = all
      .filter((task) => !task.filename.startsWith(`${task.id}-`))
      .map((task) => `${task.where} says id: ${task.id}`);

    expect(disagreeing).toEqual([]);
  });

  test("no task refers in prose to an id that does not exist", () => {
    // The dangling reference is what the renumbering leaves behind, and it is
    // silent: `see B130` reads fine and resolves to nothing, or worse, to a
    // task about something else entirely.
    //
    // Two digits at least, because that is how the script spells an id —
    // `padStart(2, "0")`, so B01 and never B1 — and because the roadmap has a
    // numbering of its own that overlaps. `docs/plans/W20-tracking.md` lists
    // "F1–F4, E4, E6, B7", and a task quoting that line is citing a roadmap
    // item, not a task. A single digit is therefore never one of ours, and
    // treating it as one only teaches people to ignore this.
    const known = new Set(all.map((task) => task.id));
    const dangling = new Set<string>();
    for (const task of all) {
      for (const [reference] of task.body.matchAll(/\bB\d{2,3}\b/g)) {
        if (!known.has(reference)) dangling.add(`${reference} (in ${task.where})`);
      }
    }

    expect([...dangling].sort()).toEqual([]);
  });

  test("every task in a categorised lane is in the folder its frontmatter names", () => {
    // The category is derived from `type` and `complexity`, never typed, so
    // this is not a style rule — it is what keeps the derivation honest.
    // Three ordinary things break it and none announces itself: a `type:`
    // corrected by hand in place, a task merged in from a branch cut before
    // the folders existed, and a file moved with `mv`.
    //
    // The failure is silent in the same way a duplicate id is. INDEX.md
    // renders the row wherever the file happens to be, so a reader browsing
    // `backlog/security/` counts five security tasks when there are six.
    // `npm run tasks -- tidy` re-files everything from the frontmatter and is
    // the whole fix.
    const misfiled = all
      .filter((task) => CATEGORISED.has(task.lane))
      .filter((task) => task.filed !== categoryFor(task.type, task.complexity, task.superseded))
      .map(
        (task) =>
          `${task.where} → ${task.lane}/${categoryFor(task.type, task.complexity, task.superseded)}/`,
      );

    expect(misfiled.sort()).toEqual([]);
  });
});
