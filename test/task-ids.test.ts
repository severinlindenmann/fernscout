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

type Task = { id: string; lane: string; filename: string; body: string };

function tasks(): Task[] {
  return LANES.flatMap((lane) => {
    const dir = path.join(ROOT, lane);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((filename) => filename.endsWith(".md"))
      .map((filename) => {
        const raw = fs.readFileSync(path.join(dir, filename), "utf8");
        return {
          id: /^id:\s*["']?(.*?)["']?\s*$/m.exec(raw)?.[1] ?? "",
          lane,
          filename,
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
      where.set(task.id, [...(where.get(task.id) ?? []), `${task.lane}/${task.filename}`]);
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
      .map((task) => `${task.lane}/${task.filename} says id: ${task.id}`);

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
        if (!known.has(reference)) dangling.add(`${reference} (in ${task.lane}/${task.filename})`);
      }
    }

    expect([...dangling].sort()).toEqual([]);
  });
});
