import { afterEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * `scripts/tasks.mjs`, and specifically which id it hands out.
 *
 * A task id is the only way tasks refer to each other — `see B01` in prose,
 * `move B01 open` on the command line — so it has to mean one thing forever.
 * It did not: `nextId()` read the working directory, which inside
 * `.claude/worktrees/<branch>` is that worktree's snapshot of `docs/tasks`
 * taken when the branch was created. Two agents branching from the same commit
 * were each told the same number was free. B99 counts three collisions and a
 * near miss in one afternoon, and two of them were still on disk when it was
 * written.
 *
 * The assertions here are all the same shape: an id claimed *somewhere else*
 * is not free, whether the script learns of that somewhere from git or by
 * looking beside itself on disk.
 */

const run = promisify(execFile);
const script = path.join(process.cwd(), "scripts", "tasks.mjs");

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return fs.realpathSync(dir);
}

afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true });
});

const LANES = ["backlog", "open", "in-development", "testing", "completed"];

/** A checkout with a `docs/tasks/` in it, holding the given ids in backlog. */
function makeCheckout(dir: string, ids: string[]): string {
  const tasks = path.join(dir, "docs", "tasks");
  for (const lane of LANES) fs.mkdirSync(path.join(tasks, lane), { recursive: true });
  fs.writeFileSync(
    path.join(tasks, "INDEX.md"),
    "# Tasks\n\n<!-- generated:begin -->\n<!-- generated:end -->\n",
  );
  for (const id of ids) {
    fs.writeFileSync(
      path.join(tasks, "backlog", `${id}-a-thing.md`),
      `---\nid: ${id}\ntitle: A thing\ntype: ISSUE\npriority: medium\ncomplexity: low\n---\n\n# ${id} — A thing\n`,
    );
  }
  return dir;
}

/** `npm run tasks -- new`, as an agent capturing something would run it. */
function create(cwd: string, title: string) {
  return run("node", [script, "new", "--type", "ISSUE", "--priority", "low", "--complexity", "low", "--title", title], { cwd });
}

describe("id allocation", () => {
  test("takes one past the highest id in this checkout", async () => {
    const dir = makeCheckout(tempDir("fernscout-tasks-"), ["B01", "B07"]);
    await create(dir, "Something");
    expect(fs.readdirSync(path.join(dir, "docs", "tasks", "backlog"))).toContain(
      "B08-something.md",
    );
  });

  /**
   * The sweep that needs no git: a sibling worktree sitting under
   * `.claude/worktrees/` has captures of its own, and an id claimed in one of
   * them is an id somebody is using. This is also what catches a worktree git
   * has been made to forget.
   */
  test("does not reuse an id claimed in a worktree beside it on disk", async () => {
    const dir = makeCheckout(tempDir("fernscout-tasks-"), ["B01", "B07"]);
    makeCheckout(path.join(dir, ".claude", "worktrees", "b07-something-else"), ["B09"]);

    await create(dir, "Something");

    const written = fs.readdirSync(path.join(dir, "docs", "tasks", "backlog"));
    expect(written).toContain("B10-something.md");
    expect(written).not.toContain("B08-something.md");
  });

  /**
   * The systematic case B99 is about. The linked worktree's `docs/tasks` is a
   * snapshot from before the newer tasks existed — exactly what a branch cut
   * yesterday looks like — and allocating from inside it must still not hand
   * out a number the main checkout has already used.
   */
  test("does not reuse an id from the main checkout when run inside a linked worktree", async () => {
    const main = makeCheckout(tempDir("fernscout-tasks-git-"), ["B01"]);
    const git = (...args: string[]) =>
      run("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args], { cwd: main });

    await git("init", "-q", "-b", "main");
    await git("add", "-A");
    await git("commit", "-qm", "one task");

    // The branch is cut here — before B02..B20 are captured on main.
    const linked = path.join(main, ".claude", "worktrees", "branch");
    await git("worktree", "add", "-q", "-b", "branch", linked);

    for (const id of ["B02", "B20"]) {
      fs.writeFileSync(
        path.join(main, "docs", "tasks", "backlog", `${id}-later.md`),
        `---\nid: ${id}\ntitle: Later\ntype: ISSUE\npriority: low\ncomplexity: low\n---\n\n# ${id} — Later\n`,
      );
    }

    // The worktree still sees only B01, and would once have said B02.
    expect(fs.readdirSync(path.join(linked, "docs", "tasks", "backlog"))).toEqual([
      "B01-a-thing.md",
    ]);

    await create(linked, "From the worktree");

    const written = fs.readdirSync(path.join(linked, "docs", "tasks", "backlog"));
    expect(written).toContain("B21-from-the-worktree.md");
    expect(written).not.toContain("B02-from-the-worktree.md");
  });
});

describe("duplicate reporting", () => {
  /**
   * Allocation cannot be the only defence — the next collision arrives through
   * a merge, a cherry-pick, or a file copied by hand — and INDEX.md renders
   * both rows without complaint, so nothing else would say it.
   */
  test("says so when two files in one checkout claim the same id", async () => {
    const dir = makeCheckout(tempDir("fernscout-tasks-"), ["B01"]);
    fs.writeFileSync(
      path.join(dir, "docs", "tasks", "testing", "B01-something-else.md"),
      "---\nid: B01\ntitle: Something else\ntype: ISSUE\npriority: low\ncomplexity: low\n---\n\n# B01 — Something else\n",
    );

    const { stderr } = await run("node", [script, "list"], { cwd: dir });

    expect(stderr).toContain("B01");
    expect(stderr).toContain("backlog/B01-a-thing.md");
    expect(stderr).toContain("testing/B01-something-else.md");
  });

  test("stays quiet when every id is claimed once", async () => {
    const dir = makeCheckout(tempDir("fernscout-tasks-"), ["B01", "B02"]);
    const { stderr } = await run("node", [script, "list"], { cwd: dir });
    expect(stderr).toBe("");
  });
});
