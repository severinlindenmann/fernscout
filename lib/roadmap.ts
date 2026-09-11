import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { clearMatterCache } from "./matterCache";

/**
 * `/docs/roadmap` — a reading of `docs/tasks/` for somebody with no checkout.
 * B675.
 *
 * `docs/tasks/` is ~1,400 files across five lanes, and the lane a task sits
 * in *is* its status (see AGENTS.md's Tasks section) — there is no `status:`
 * field to read instead. This walks the tree the way `lib/plan.ts` reads
 * `plan.md`: `gray-matter` over files already on disk, nothing stored,
 * nothing written back. It deliberately does not import `scripts/tasks.mjs`,
 * which is a CLI entry point — it reads `process.argv`, shells out to `git`
 * and calls `process.exit` at module scope, none of which belong in a page
 * render.
 *
 * **Metadata only** — id, title, type, priority. Not the body: a body names
 * files and argues with itself, and several are security findings written in
 * prose rather than tagged `type: SECURITY`. Publishing bodies would need a
 * person to read all ~1,400 of them first for exactly that reason.
 *
 * **`SECURITY` is filtered on `type`, in every lane, not on the folder.**
 * `scripts/tasks.mjs` only files into category folders (`security/`,
 * `issue/`, …) *within* `backlog/` — every other lane is flat, so a ticket
 * typed `SECURITY` that has moved to `testing/` or `completed/` sits at that
 * lane's top level with no `security` path segment at all. A path-only
 * filter would publish it. This filters on `type: SECURITY` first, and
 * additionally skips `backlog/security/` by path as a second, redundant
 * guard — the two only disagree when something has gone wrong, which is
 * exactly when both should be checked.
 *
 * A file whose frontmatter fails to parse — a handful do, an unquoted `:` in
 * a title being the usual cause — is skipped and logged rather than taking
 * the whole page down, the same shape `lib/plan.ts` uses for `plan.md`.
 */

const ROOT = path.join(process.cwd(), "docs", "tasks");

/** Flow order — same as `scripts/tasks.mjs`'s `LANES`, and the order this
 * page renders them in. */
const LANES = ["backlog", "open", "in-development", "testing", "completed"] as const;
type Lane = (typeof LANES)[number];

type RoadmapTask = {
  id: string;
  title: string;
  type: string;
  priority: string;
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

function readTask(file: string): RoadmapTask | null {
  let data: Record<string, unknown>;
  try {
    ({ data } = matter(fs.readFileSync(file, "utf8")));
  } catch (err) {
    // See clearMatterCache's doc comment for why this call is not optional
    // after a throwing parse (B312).
    clearMatterCache();
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(`[roadmap] ${file}: its frontmatter could not be parsed: ${why}`);
    return null;
  }
  if (typeof data.id !== "string" || typeof data.title !== "string") return null;
  return {
    id: data.id,
    title: data.title,
    type: typeof data.type === "string" ? data.type : "",
    priority: typeof data.priority === "string" ? data.priority : "",
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
      .filter((file) => !file.includes(`${path.sep}backlog${path.sep}security${path.sep}`))
      .map(readTask)
      .filter((t): t is RoadmapTask => t !== null && t.type !== "SECURITY")
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    return { lane, tasks };
  });
}
