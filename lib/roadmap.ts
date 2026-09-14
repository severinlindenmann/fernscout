import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { clearMatterCache } from "./matterCache";

/**
 * `/docs/roadmap` — a reading of `docs/tasks/` for somebody with no checkout.
 * B675, redrawn as a board by B1721.
 *
 * `docs/tasks/` is ~1,600 files across five lanes, and the lane a task sits
 * in *is* its status (see AGENTS.md's Tasks section) — there is no `status:`
 * field to read instead. This walks the tree the way `lib/plan.ts` reads
 * `plan.md`: `gray-matter` over files already on disk, nothing stored,
 * nothing written back. It deliberately does not import `scripts/tasks.mjs`,
 * which is a CLI entry point — it reads `process.argv`, shells out to `git`
 * and calls `process.exit` at module scope, none of which belong in a page
 * render.
 *
 * **`SECURITY` is filtered on `type`, in every lane, not on the folder.**
 * `scripts/tasks.mjs` only files into category folders (`security/`,
 * `issue/`, …) *within* `backlog/` — every other lane is flat, so a ticket
 * typed `SECURITY` that has moved to `testing/` or `completed/` sits at that
 * lane's top level with no `security` path segment at all. A path-only
 * filter would publish it. This filters on `type: SECURITY` first, and
 * additionally skips `backlog/security/` by path as a second, redundant
 * guard — the two only disagree when something has gone wrong, which is
 * exactly when both should be checked. `getTask()` applies the same two
 * guards, because a per-ticket route is a second door onto the same tree.
 *
 * **Bodies are published, since B1721 — for everything this file returns.**
 * B675 withheld them on the grounds that a body names internal files and
 * that several security findings are written in prose rather than tagged.
 * The repository is public at `github.com/severinlindenmann/fernscout`, so
 * the first half stopped being a reason; the second half is what the
 * `type: SECURITY` filter above is for, and it did not change.
 *
 * A file whose frontmatter fails to parse — a handful do, an unquoted `:` in
 * a title being the usual cause — is skipped and logged rather than taking
 * the whole page down, the same shape `lib/plan.ts` uses for `plan.md`.
 */

const ROOT = path.join(process.cwd(), "docs", "tasks");

/** Flow order — same as `scripts/tasks.mjs`'s `LANES`. */
const LANES = ["backlog", "open", "in-development", "testing", "completed"] as const;
export type Lane = (typeof LANES)[number];

/** `complexity:` as the task files write it. The board draws a card's whole
 * shape from this, which is the one field B675's page never read. */
export type Complexity = "high" | "medium" | "low" | "";

export type RoadmapTask = {
  id: string;
  title: string;
  type: string;
  priority: string;
  complexity: Complexity;
  area: string;
  lane: Lane;
  /** The most recent of `completed` / `merged` / `started` / `found`, as
   * written — an ISO instant or a bare date, or `""`. Sorting Done by this is
   * the only thing that makes "most recent first" mean anything. */
  date: string;
  /** Repository-relative, for the link to the same file on GitHub. */
  path: string;
  /**
   * In `backlog/superseded/` or `backlog/wont-do/` — overtaken by another
   * ticket, or decided against by a person. Still a task file, still in
   * `backlog/`, and emphatically not "wanted, not started": the board leaves
   * these off its Backlog column and the search labels them, because a
   * roadmap that promises twenty-six features somebody already cancelled is
   * worse than one that omits them.
   */
  shelved: boolean;
};

export type RoadmapLane = {
  lane: Lane;
  tasks: RoadmapTask[];
};

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walk(full));
    } else if (entry.name.endsWith(".md") && entry.name !== "INDEX.md") {
      out.push(full);
    }
  }
  return out;
}

/** `scripts/tasks.mjs`'s two resting places for a ticket nobody will build. */
const SHELVED = ["superseded", "wont-do"];

/** The one place a `type: SECURITY` ticket is refused, by both guards. */
function isSecurity(file: string, type: unknown): boolean {
  return type === "SECURITY" || file.includes(`${path.sep}backlog${path.sep}security${path.sep}`);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function parse(file: string): { data: Record<string, unknown>; body: string } | null {
  try {
    const { data, content } = matter(fs.readFileSync(file, "utf8"));
    return { data, body: content.trim() };
  } catch (err) {
    // See clearMatterCache's doc comment for why this call is not optional
    // after a throwing parse (B312).
    clearMatterCache();
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(`[roadmap] ${file}: its frontmatter could not be parsed: ${why}`);
    return null;
  }
}

function toTask(file: string, lane: Lane, data: Record<string, unknown>): RoadmapTask | null {
  if (typeof data.id !== "string" || typeof data.title !== "string") return null;
  const complexity = str(data.complexity);
  return {
    id: data.id,
    title: data.title,
    type: str(data.type),
    priority: str(data.priority),
    complexity: (["high", "medium", "low"].includes(complexity) ? complexity : "") as Complexity,
    area: str(data.area),
    lane,
    date: str(data.completed) || str(data.merged) || str(data.started) || str(data.found),
    // Relative to the repository root, not to `root` — the fixture tree in
    // test/ is rooted elsewhere and its paths are never linked anywhere.
    path: path.relative(process.cwd(), file).split(path.sep).join("/"),
    shelved: SHELVED.some((folder) => file.includes(`${path.sep}backlog${path.sep}${folder}${path.sep}`)),
  };
}

/**
 * Every task, grouped by lane, with every `type: SECURITY` ticket removed —
 * wherever in the tree it sits. Empty (rather than throwing) when
 * `docs/tasks/` is absent, which is every instance whose deploy is not this
 * repository's own checkout.
 *
 * `root` defaults to the real `docs/tasks/` and exists only so
 * `test/roadmap.test.ts` can point this at a fixture tree instead — the live
 * tree changes hourly and is not something a test should depend on.
 */
export function getRoadmap(root: string = ROOT): RoadmapLane[] {
  if (!fs.existsSync(root)) return [];

  return LANES.map((lane) => {
    const dir = path.join(root, lane);
    if (!fs.existsSync(dir)) return { lane, tasks: [] };

    const tasks = walk(dir)
      .map((file) => {
        const parsed = parse(file);
        if (!parsed || isSecurity(file, parsed.data.type)) return null;
        return toTask(file, lane, parsed.data);
      })
      .filter((t): t is RoadmapTask => t !== null)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    return { lane, tasks };
  });
}

/** Every task in one flat list, which is what a board and a search want. */
export function getTasks(root: string = ROOT): RoadmapTask[] {
  return getRoadmap(root).flatMap((l) => l.tasks);
}

/**
 * One task with its body, for `/docs/roadmap/<id>`.
 *
 * `null` covers all three ways this legitimately finds nothing — no such id,
 * unparseable frontmatter, and `type: SECURITY` — so the route can answer
 * `notFound()` once and never has to tell the three apart out loud. A page
 * that said "this ticket exists but you may not read it" would be leaking the
 * one thing the filter is there to keep quiet.
 *
 * The id is matched on the filename prefix first (`scripts/tasks.mjs` names
 * every file `<id>-<slug>.md`) so a hit costs one `readFileSync` rather than
 * sixteen hundred.
 */
export function getTask(id: string, root: string = ROOT): (RoadmapTask & { body: string }) | null {
  if (!/^[A-Za-z]+\d+$/.test(id) || !fs.existsSync(root)) return null;

  for (const lane of LANES) {
    const dir = path.join(root, lane);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (path.basename(file).split("-")[0] !== id) continue;
      const parsed = parse(file);
      if (!parsed || isSecurity(file, parsed.data.type)) return null;
      const task = toTask(file, lane, parsed.data);
      return task && task.id === id ? { ...task, body: parsed.body } : null;
    }
  }
  return null;
}
