import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The build completeness check (B1429).
 *
 * A deploy on 2026-09-11 built cleanly, restarted, reported success and
 * answered /api/health with `ok` while `/<user>/contacts` returned 500 —
 * the page's client reference manifest was not in the build. Every gate was
 * looking somewhere else, and the page that broke was owner-only, so nothing
 * an unauthenticated smoke test could reach would have found it.
 *
 * These assertions are all of the form "this DOES fail the deploy", because
 * every failure of this check is silent in the other direction: a check that
 * quietly passes a broken build leaves a green deploy in front of a 500, which
 * is exactly the state it exists to prevent.
 */

const run = promisify(execFile);
const script = path.join(process.cwd(), "scripts", "check-build.mjs");

/** A `.next` holding these routes, each with a manifest unless named broken. */
async function build(routes: string[], broken: string[] = []): Promise<string> {
  const dist = await mkdtemp(path.join(tmpdir(), "check-build-"));
  for (const route of routes) {
    const dir = path.join(dist, "server", "app", route);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "page.js"), "// built page\n");
    if (!broken.includes(route)) {
      await writeFile(path.join(dir, "page_client-reference-manifest.js"), "// manifest\n");
    }
  }
  return dist;
}

const check = (dist: string) =>
  run("node", [script, dist]).then(
    ({ stdout, stderr }) => ({ code: 0, out: stdout + stderr }),
    (err: { code: number; stdout: string; stderr: string }) => ({
      code: err.code,
      out: err.stdout + err.stderr,
    }),
  );

describe("check-build", () => {
  test("passes a build where every page has its manifest", async () => {
    const { code, out } = await check(await build(["", "about", "[user]/contacts"]));
    expect(code).toBe(0);
    expect(out).toContain("3 pages");
  });

  test("fails, and names the route, when one manifest is missing", async () => {
    const dist = await build(["", "about", "[user]/contacts"], ["[user]/contacts"]);
    const { code, out } = await check(dist);
    expect(code).toBe(1);
    expect(out).toContain("[user]/contacts");
    // The page that is fine must not be reported as broken — an operator
    // reading this is about to go and open the routes it names.
    expect(out).not.toContain("/about");
  });

  test("refuses a directory with no pages in it rather than calling it clean", async () => {
    // Distinct from a missing manifest, and distinct from success: a deploy
    // restarting onto an empty .next is its own way to take the site down,
    // and "0 pages, all present" would read as a pass.
    const { code, out } = await check(await mkdtemp(path.join(tmpdir(), "check-build-")));
    expect(code).toBe(2);
    expect(out).toContain("not a finished build");
  });

  test("is the check the deploy actually runs before it restarts", async () => {
    // The script is worth nothing if the deploy does not call it, or calls it
    // after the restart — by which time the broken build is serving.
    const deploy = await run("cat", [path.join(process.cwd(), "scripts", "deploy.sh")]);
    const called = deploy.stdout.indexOf("scripts/check-build.mjs");
    const restart = deploy.stdout.indexOf('log "restarting');
    expect(called).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(-1);
    expect(called).toBeLessThan(restart);
  });
});
