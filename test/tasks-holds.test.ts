import { afterEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The two things `scripts/tasks.mjs` writes into a task's frontmatter as work
 * happens: **when** it moved, and **who** is on it.
 *
 * Both exist because this repository runs several agents at once. A stamp that
 * was only a date said "a Tuesday" and nothing else — B01 was found, started
 * and merged on 2026-09-01, and the file cannot say in which order or how long
 * it waited. And the lane alone says *somebody* is on a task, not which
 * session, so two agents could each read `in-development/` and each conclude
 * the other's work was theirs to continue. B143 and B144 are one afternoon of
 * that going wrong.
 *
 * Id allocation is the sibling concern and lives in `tasks-script.test.ts`.
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

const ONE = "aaaaaaaa-1111-2222-3333-444444444444";
const TWO = "bbbbbbbb-9999-8888-7777-666666666666";

/** A checkout with a `docs/tasks/`, holding the given ids in backlog. */
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

/** The script, run as an agent runs it: with a session id in the environment. */
function tasks(cwd: string, args: string[], session?: string) {
  // No session must mean *absent*, not empty — an empty string is what a
  // person running the script by hand would look like, and the script has to
  // read that as "nobody is holding this".
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (session) env.CLAUDE_CODE_SESSION_ID = session;
  return run("node", [script, ...args], { cwd, env });
}

/** A task's frontmatter, wherever in the lanes it has got to. */
function front(dir: string, id: string): string {
  for (const lane of LANES) {
    const at = path.join(dir, "docs", "tasks", lane);
    const file = fs.readdirSync(at).find((f) => f.startsWith(`${id}-`));
    if (file) return fs.readFileSync(path.join(at, file), "utf8").split("---")[1];
  }
  throw new Error(`${id} is in no lane.`);
}

function value(dir: string, id: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front(dir, id));
  return match?.[1].trim().replace(/^"(.*)"$/, "$1");
}

/** `2026-09-03T19:07:32Z` — the whole instant, not the day it happened on. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

describe("stamps", () => {
  test("records a whole instant, not a date", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), []);
    await tasks(dir, [
      "new", "--type", "ISSUE", "--priority", "low", "--complexity", "low",
      "--title", "A thing",
    ]);

    expect(value(dir, "B01", "found")).toMatch(INSTANT);

    await tasks(dir, ["move", "B01", "in-development"], ONE);
    expect(value(dir, "B01", "started")).toMatch(INSTANT);

    await tasks(dir, ["move", "B01", "testing"], ONE);
    expect(value(dir, "B01", "merged")).toMatch(INSTANT);
  });

  /**
   * A timestamp contains `:`, and the quoting used to be the caller's job — so
   * the value arrived pre-quoted, `setField` saw the colon and quoted it a
   * second time. The frontmatter would have read `merged: "\"2026-…\""`.
   */
  test("quotes the instant exactly once", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);

    expect(front(dir, "B01")).toMatch(/^started: "\d{4}-\d{2}-\d{2}T[\d:]+Z"$/m);
  });

  /**
   * The 130 tasks written before this keep date-only stamps. Widening them to a
   * midnight instant would invent a time nobody recorded, so the script has to
   * go on reading and rewriting them untouched.
   */
  test("leaves a date-only stamp from before alone", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), []);
    const file = path.join(dir, "docs", "tasks", "open", "B01-an-old-one.md");
    fs.writeFileSync(
      file,
      `---\nid: B01\ntitle: An old one\ntype: ISSUE\npriority: low\ncomplexity: low\nfound: "2026-09-01"\n---\n\n# B01 — An old one\n`,
    );

    await tasks(dir, ["move", "B01", "in-development"], ONE);

    expect(value(dir, "B01", "found")).toBe("2026-09-01");
    expect(value(dir, "B01", "started")).toMatch(INSTANT);
  });
});

describe("the hold", () => {
  test("taking a task records the session that took it", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);

    expect(value(dir, "B01", "session")).toBe(ONE);
    expect(value(dir, "B01", "claimed")).toMatch(INSTANT);
  });

  /**
   * The case the parenthetical in B145 is about: the agent that merged is not
   * the one that verifies. `test-the-live-site` dispatches a subagent per
   * ticket, and a hold left behind by the builder would tell all three of them
   * that every ticket in the lane was taken.
   */
  test("merging into testing lets go, so the verifier can take it", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);
    await tasks(dir, ["move", "B01", "testing"], ONE);

    expect(value(dir, "B01", "session")).toBeUndefined();
    expect(value(dir, "B01", "claimed")).toBeUndefined();

    await tasks(dir, ["claim", "B01"], TWO);
    expect(value(dir, "B01", "session")).toBe(TWO);
  });

  test("claiming does not move the task out of its lane", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);
    await tasks(dir, ["move", "B01", "testing"], ONE);
    await tasks(dir, ["claim", "B01"], TWO);

    expect(fs.readdirSync(path.join(dir, "docs", "tasks", "testing"))).toEqual([
      "B01-a-thing.md",
    ]);
  });

  test("release drops both halves of the hold together", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);
    await tasks(dir, ["release", "B01"], ONE);

    expect(front(dir, "B01")).not.toMatch(/^(session|claimed):/m);
  });

  test("a person moving a task by hand holds nothing", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"]);

    expect(value(dir, "B01", "session")).toBeUndefined();
  });

  test("a lane where nobody works refuses the claim", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);

    await expect(tasks(dir, ["claim", "B01"], ONE)).rejects.toThrow(/backlog\//);
  });
});

describe("the lease", () => {
  /**
   * An error and not a warning, because a warning is not a lock: an agent reads
   * one, decides it is probably about somebody else, and carries on.
   */
  test("refuses a task another session is already on, and names the holder", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);

    await expect(tasks(dir, ["claim", "B01"], TWO)).rejects.toThrow(/held by session aaaaaaaa/);
    expect(value(dir, "B01", "session")).toBe(ONE);
  });

  test("refuses the lane move that would take it too", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);
    await tasks(dir, ["move", "B01", "testing"], ONE);
    await tasks(dir, ["claim", "B01"], TWO);

    await expect(tasks(dir, ["move", "B01", "in-development"], ONE)).rejects.toThrow(
      /held by session bbbbbbbb/,
    );
    expect(fs.readdirSync(path.join(dir, "docs", "tasks", "testing"))).toContain(
      "B01-a-thing.md",
    );
  });

  test("the session already holding it may take it again", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);

    await expect(tasks(dir, ["claim", "B01"], ONE)).resolves.toBeTruthy();
  });

  /** For the ordinary case: the holder is a session that died. */
  test("--force breaks the lease", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);
    await tasks(dir, ["claim", "B01", "--force"], TWO);

    expect(value(dir, "B01", "session")).toBe(TWO);
  });

  test("--session names the holder when the environment cannot", async () => {
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01"]);
    await tasks(dir, ["move", "B01", "in-development", "--session", TWO]);

    expect(value(dir, "B01", "session")).toBe(TWO);
  });
});

describe("what INDEX.md shows", () => {
  /**
   * Sixty backlog rows of an empty column is noise, and noise in a generated
   * table is what stops people reading generated tables.
   */
  test("carries a holder column only in the lanes where a hold means something", async () => {
    // Every lane needs an occupant: an empty one renders "_Nothing here._"
    // and has no header row to look at.
    const dir = makeCheckout(tempDir("fernscout-holds-"), ["B01", "B02", "B03", "B04"]);
    await tasks(dir, ["move", "B01", "in-development"], ONE);
    await tasks(dir, ["move", "B02", "testing"], ONE);
    await tasks(dir, ["move", "B03", "completed"], ONE);

    const index = fs.readFileSync(path.join(dir, "docs", "tasks", "INDEX.md"), "utf8");
    const sections = index.split(/^## /m);
    const headerAfter = (lane: string) =>
      sections
        .find((s) => s.startsWith(`${lane}\n`))
        ?.split("\n")
        .find((l) => l.startsWith("| #"));

    expect(headerAfter("in-development")).toContain("Held by");
    expect(headerAfter("testing")).toContain("Held by");
    expect(headerAfter("backlog")).not.toContain("Held by");
    expect(headerAfter("completed")).not.toContain("Held by");
    expect(index).toContain("`aaaaaaaa`");
  });
});
