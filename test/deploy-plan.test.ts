import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

/**
 * The step chooser in `scripts/deploy.sh` (B258).
 *
 * A deploy used to run the same eight steps whatever arrived, so there was
 * nothing here to test: the plan was a constant. Now it is read off
 * `git diff`, which makes two things worth pinning down.
 *
 * The first is that the cheap answers stay cheap — a task file must not cost a
 * 40-second build, which is the whole point of the change.
 *
 * The second matters more, and it is the reason this file exists rather than a
 * comment saying the script was tried once. **Every failure of this classifier
 * is silent.** A path that should have asked for a build and does not leaves a
 * green deploy in front of a stale site, and nothing about it looks wrong from
 * outside — the health check passes, because the old build is healthy. So the
 * assertions below are mostly of the form "this path DOES cost a build", and
 * the last one covers the case nobody will think of: a path this list has
 * never heard of has to fall through to a build, not to silence.
 */

const run = promisify(execFile);
const script = path.join(process.cwd(), "scripts", "deploy.sh");

const BUILD = "build";
const RESTART = "restart fernscout";
const INSTALL = "install dependencies";
const MIGRATE = "run migrations";
const SYNC = "sync shipped content";
const UNITS = "install systemd units";
const CADDY = "check the Caddy config";

/** The plan for a set of changed paths, as a set of step names. */
async function plan(...paths: string[]): Promise<Set<string>> {
  const { stdout } = await run("bash", [script, "--plan", ...paths]);
  const steps = new Set<string>();
  // The log lines are colourised for a terminal; the escape sequences are not
  // what this test is about.
  const plain = stdout.replace(/\[[0-9;]*m/g, "");
  for (const line of plain.split("\n")) {
    const match = /^==> will (.+)$/.exec(line.trim());
    if (match) steps.add(match[1]);
    if (line.includes("nothing to do")) steps.add("nothing");
  }
  return steps;
}

describe("what a change costs a deploy", () => {
  test("prose, tasks, tests and CI cost nothing", async () => {
    for (const file of [
      "docs/tasks/INDEX.md",
      "docs/runbook.md",
      "AGENTS.md",
      "README.md",
      "test/entries.test.ts",
      ".github/workflows/ci.yml",
      ".claude/skills/deploy/SKILL.md",
      "knip.jsonc",
    ]) {
      expect(await plan(file), file).toEqual(new Set(["nothing"]));
    }
  });

  test("code builds and restarts, and does not reinstall", async () => {
    for (const file of [
      "lib/entries.ts",
      "app/page.tsx",
      "components/Landing.tsx",
      "public/manifest.json",
      "next.config.ts",
      "middleware.ts",
    ]) {
      expect(await plan(file), file).toEqual(new Set([BUILD, RESTART]));
    }
  });

  test("a path nothing here has heard of still builds", async () => {
    // The one that has to be right for the wrong reason: a directory added
    // next year is code until somebody says otherwise, because the cost of
    // guessing "code" is a build nobody needed and the cost of guessing
    // "prose" is a deploy that quietly served the previous release.
    expect(await plan("something/nobody/predicted.ts")).toEqual(new Set([BUILD, RESTART]));
  });

  test("the lockfile is the only thing that reinstalls", async () => {
    expect(await plan("package-lock.json")).toEqual(new Set([INSTALL, BUILD, RESTART]));
    expect(await plan("package.json")).toEqual(new Set([INSTALL, BUILD, RESTART]));
    expect(await plan("lib/entries.ts")).not.toContain(INSTALL);
  });

  test("a migration migrates", async () => {
    expect(await plan("lib/db/migrations/011-a-new-table.ts")).toEqual(
      new Set([MIGRATE, BUILD, RESTART]),
    );
    expect(await plan("lib/db/schema.ts")).toContain(MIGRATE);
    // Not every file under lib/db/ is a schema change.
    expect(await plan("lib/db/client.ts")).not.toContain(MIGRATE);
  });

  test("shipped locales and rates are copied, and the rest of content is not", async () => {
    // B56 is the bug this half exists for: a translation that never left the
    // repository.
    expect(await plan("content/locales/de.json")).toEqual(new Set([SYNC, BUILD, RESTART]));
    expect(await plan("content/rates/ecb.json")).toContain(SYNC);

    // And the operator's own half, which a deploy must not touch — but must
    // not pass over in silence either.
    const { stdout } = await run("bash", [script, "--plan", "content/example/config.json"]);
    expect(stdout).toContain("nothing to do");
    expect(stdout).toContain("a deploy does not copy it");
  });

  test("units install and restart; the Caddy file is only reported on", async () => {
    expect(await plan("deploy/fernscout.service")).toEqual(new Set([UNITS, RESTART]));
    expect(await plan("deploy/fernscout-backup.timer")).toContain(UNITS);
    // Nothing about the proxy is this script's to change (B66), so a Caddy
    // change must not restart the app to say so.
    expect(await plan("deploy/fernscout.caddy")).toEqual(new Set([CADDY]));
  });

  test("the steps a mixed diff needs are the union of them", async () => {
    expect(
      await plan(
        "package-lock.json",
        "lib/db/migrations/011-a-new-table.ts",
        "content/locales/hu.json",
        "deploy/fernscout.service",
        "deploy/fernscout.caddy",
        "docs/README.md",
      ),
    ).toEqual(new Set([INSTALL, MIGRATE, SYNC, BUILD, UNITS, RESTART, CADDY]));
  });

  test("--plan with no paths is a usage error, not an empty plan", async () => {
    // Otherwise a caller that computed an empty file list would be told there
    // is nothing to do, which is the same sentence for "nothing changed" and
    // "I failed to work out what changed".
    await expect(run("bash", [script, "--plan"])).rejects.toMatchObject({ code: 2 });
  });
});
