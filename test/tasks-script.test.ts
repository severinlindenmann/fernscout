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
function create(cwd: string, title: string, ...extra: string[]) {
  return run("node", [script, "new", "--type", "ISSUE", "--priority", "low", "--complexity", "low", "--title", title, ...extra], { cwd });
}

/** git, with an identity, so a temporary repository can commit at all. */
function git(cwd: string) {
  return (...args: string[]) =>
    run("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args], { cwd });
}

/** A checkout that is also a git repository, with its tasks committed. */
async function makeRepo(prefix: string, ids: string[]): Promise<string> {
  const dir = makeCheckout(tempDir(prefix), ids);
  const at = git(dir);
  await at("init", "-q", "-b", "main");
  await at("add", "-A");
  await at("commit", "-qm", "tasks");
  return dir;
}

/** `npm run tasks` for its own sake, tolerating a non-zero exit. */
async function listing(cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run("node", [script, "list"], { cwd });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
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
    const main = await makeRepo("fernscout-tasks-git-", ["B01"]);
    const at = git(main);

    // The branch is cut here — before B02..B20 are captured on main.
    const linked = path.join(main, ".claude", "worktrees", "branch");
    await at("worktree", "add", "-q", "-b", "branch", linked);

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

/**
 * B143. taskRoots() closed the gap between two *branches*; this is the gap
 * between two *processes*. Four agents branched from one commit scan the same
 * files, reach the same conclusion and write captures whose titles — and so
 * whose filenames — differ, which is why nothing on disk ever collided and the
 * duplicate was permanent. On 2026-09-03 four of them called it B130.
 */
describe("simultaneous capture", () => {
  test("four worktrees off one commit are given four different ids", async () => {
    const main = await makeRepo("fernscout-tasks-race-", ["B01"]);
    const at = git(main);

    const worktrees: string[] = [];
    for (const name of ["one", "two", "three", "four"]) {
      const linked = path.join(main, ".claude", "worktrees", name);
      await at("worktree", "add", "-q", "-b", name, linked);
      worktrees.push(linked);
    }

    // Started together, on purpose: serially they would pass whatever the
    // script did, because each run sees the one before it on disk.
    await Promise.all(worktrees.map((dir, n) => create(dir, `Found something ${n}`)));

    const ids = worktrees.map((dir) => {
      const [written] = fs
        .readdirSync(path.join(dir, "docs", "tasks", "backlog"))
        .filter((f) => f !== "B01-a-thing.md");
      return written.slice(0, written.indexOf("-"));
    });

    expect(new Set(ids).size).toBe(4);
    expect(ids).not.toContain("B01");
  });

  test("an id handed out is not handed out again once its file is gone", async () => {
    // A capture committed on a branch whose worktree has since been removed is
    // invisible to a scan of the filesystem. Its reservation is not.
    const main = await makeRepo("fernscout-tasks-reserve-", ["B01"]);
    const linked = path.join(main, ".claude", "worktrees", "gone");
    await git(main)("worktree", "add", "-q", "-b", "gone", linked);

    await create(linked, "Captured then lost");
    fs.rmSync(linked, { recursive: true, force: true });
    await git(main)("worktree", "prune");

    await create(main, "Captured later");
    expect(fs.readdirSync(path.join(main, "docs", "tasks", "backlog"))).toEqual([
      "B01-a-thing.md",
      "B03-captured-later.md",
    ]);
  });
});

/**
 * B143 again, from the other end: the reason agents hand-wrote captures at all
 * was that `new` rewrote INDEX.md, and a worktree's regenerated table is both
 * stale and the thing that conflicts on every merge.
 */
describe("INDEX.md", () => {
  const indexOf = (dir: string) =>
    fs.readFileSync(path.join(dir, "docs", "tasks", "INDEX.md"), "utf8");

  test("is left alone when a capture is made from a linked worktree", async () => {
    const main = await makeRepo("fernscout-tasks-index-", ["B01"]);
    const linked = path.join(main, ".claude", "worktrees", "branch");
    await git(main)("worktree", "add", "-q", "-b", "branch", linked);

    const before = indexOf(linked);
    const { stdout } = await create(linked, "Something");

    expect(stdout).toContain("not rewritten");
    expect(indexOf(linked)).toBe(before);
  });

  test("is written from a linked worktree when --index says so", async () => {
    const main = await makeRepo("fernscout-tasks-index-forced-", ["B01"]);
    const linked = path.join(main, ".claude", "worktrees", "branch");
    await git(main)("worktree", "add", "-q", "-b", "branch", linked);

    await create(linked, "Something", "--index");
    expect(indexOf(linked)).toContain("Something");
  });

  test("is written as before in the checkout that owns the folders", async () => {
    const main = await makeRepo("fernscout-tasks-index-main-", ["B01"]);
    await create(main, "Something");
    expect(indexOf(main)).toContain("Something");
  });
});

/**
 * B201. The shared checkout came off `main` with eighteen commits on it and
 * nothing said so — every command an agent runs keeps working while detached,
 * and the next `git checkout main` would have rewound past all of them.
 */
describe("checkout state", () => {
  test("names a detached checkout, its stranded commits and the recovery", async () => {
    const dir = await makeRepo("fernscout-tasks-detached-", ["B01"]);
    const at = git(dir);
    await at("checkout", "-q", "--detach");
    for (const n of [1, 2]) {
      fs.writeFileSync(path.join(dir, `note-${n}.txt`), "x");
      await at("add", "-A");
      await at("commit", "-qm", `stranded ${n}`);
    }

    const { stderr } = await listing(dir);

    expect(stderr).toContain("detached HEAD");
    expect(stderr).toContain("2 commits are on no branch");
    expect(stderr).toContain("git branch -f main");
  });

  test("refuses to suggest a recovery once main has diverged", async () => {
    const dir = await makeRepo("fernscout-tasks-diverged-", ["B01"]);
    const at = git(dir);

    await at("checkout", "-q", "-b", "elsewhere");
    fs.writeFileSync(path.join(dir, "theirs.txt"), "x");
    await at("add", "-A");
    await at("commit", "-qm", "on elsewhere");

    await at("checkout", "-q", "main");
    fs.writeFileSync(path.join(dir, "ours.txt"), "x");
    await at("add", "-A");
    await at("commit", "-qm", "on main");

    await at("checkout", "-q", "--detach", "elsewhere");

    const { stderr } = await listing(dir);

    expect(stderr).toContain("detached HEAD");
    expect(stderr).toContain("has diverged");
    expect(stderr).not.toContain("git branch -f main");
  });

  test("sees a detached checkout from a worktree that is on a branch", async () => {
    // Which is the case that matters: the agent about to merge into it is
    // standing somewhere else.
    const main = await makeRepo("fernscout-tasks-detached-seen-", ["B01"]);
    const linked = path.join(main, ".claude", "worktrees", "branch");
    await git(main)("worktree", "add", "-q", "-b", "branch", linked);
    await git(main)("checkout", "-q", "--detach");

    const { stderr } = await listing(linked);
    expect(stderr).toContain("detached HEAD");
  });

  test("says when this checkout is halfway through a merge", async () => {
    const dir = await makeRepo("fernscout-tasks-midmerge-", ["B01"]);
    const at = git(dir);
    const contested = path.join(dir, "contested.txt");

    fs.writeFileSync(contested, "base\n");
    await at("add", "-A");
    await at("commit", "-qm", "base");

    await at("checkout", "-q", "-b", "theirs");
    fs.writeFileSync(contested, "theirs\n");
    await at("add", "-A");
    await at("commit", "-qm", "theirs");

    await at("checkout", "-q", "main");
    fs.writeFileSync(contested, "ours\n");
    await at("add", "-A");
    await at("commit", "-qm", "ours");

    await at("merge", "theirs").catch(() => undefined); // conflicts, on purpose

    const { stderr } = await listing(dir);
    expect(stderr).toContain("in the middle of a merge");
  });

  test("stays quiet in a checkout that is on a branch and finished", async () => {
    const dir = await makeRepo("fernscout-tasks-clean-", ["B01", "B02"]);
    const { stderr } = await listing(dir);
    expect(stderr).toBe("");
  });
});
