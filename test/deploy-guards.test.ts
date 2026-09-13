import { afterEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Three ways `scripts/deploy.sh` used to be able to take fernscout.ch down
 * (B1311, B1312, B1313), each guarded here against a real invocation of the
 * script rather than against the idea of it — every scenario below drives
 * `bash scripts/deploy.sh` exactly as the VPS would, with `APP_DIR`,
 * `RUN_AS` and friends pointed at a throwaway fixture instead of
 * `/srv/fernscout`.
 */

const run = promisify(execFile);
const script = path.join(process.cwd(), "scripts", "deploy.sh");

const dirs: string[] = [];
function tmpAppDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-guard-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A PID nothing on this machine holds right now — spawn and let it exit. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  return child.pid ?? 999999;
}

describe("B1313: a lock stops two deploys from running against the same checkout", () => {
  test("refuses while the holder is still alive, and never reaches git", async () => {
    const appDir = tmpAppDir();
    fs.mkdirSync(path.join(appDir, ".deploy.lock"));
    // This test process's own PID is guaranteed alive for the duration of the
    // assertion — the honest way to simulate "another deploy is still
    // running" without actually racing a second `deploy.sh`.
    fs.writeFileSync(path.join(appDir, ".deploy.lock", "pid"), String(process.pid));

    await expect(
      run("bash", [script], { env: { ...process.env, APP_DIR: appDir, RUN_AS: os.userInfo().username } }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("another deploy"),
    });

    // Refused before it ever touched git — this directory was never a repo.
    expect(fs.existsSync(path.join(appDir, ".git"))).toBe(false);
  });

  test("a lock left by a crashed deploy is reclaimed automatically, not refused", async () => {
    const appDir = tmpAppDir();
    fs.mkdirSync(path.join(appDir, ".deploy.lock"));
    fs.writeFileSync(path.join(appDir, ".deploy.lock", "pid"), String(deadPid()));

    // This run still fails — the fixture is an empty directory, not a git
    // checkout — but it must fail for THAT reason, never because the stale
    // lock was mistaken for a live one.
    const result = await run("bash", [script], {
      env: { ...process.env, APP_DIR: appDir, RUN_AS: os.userInfo().username },
    }).catch((e) => e);

    expect(result.stdout + result.stderr).toContain("clearing a stale lock");
    expect(result.stdout + result.stderr).not.toContain("another deploy");
  });
});

describe("B1313: a detached HEAD fails the first git step by name, not by git's own wording", () => {
  test("says what happened and what to run, before ever pulling", async () => {
    const appDir = tmpAppDir();
    spawnSync("git", ["init", "-q", "-b", "main", appDir]);
    spawnSync("git", ["-C", appDir, "commit", "-q", "--allow-empty", "-m", "init"]);
    spawnSync("git", ["-C", appDir, "checkout", "-q", "--detach", "HEAD"]);

    await expect(
      run("bash", [script], {
        env: {
          ...process.env,
          APP_DIR: appDir,
          RUN_AS: os.userInfo().username,
          PORT: "18173", // nothing listens here, so served_commit() fails fast
        },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("is not on a branch"),
    });
  });
});

describe("B1311: an unreadable config.json fails the build before .next is touched", () => {
  test("names the file and the user, and never runs the build", async () => {
    const appDir = tmpAppDir();
    const bareRemote = tmpAppDir();
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", bareRemote]);
    spawnSync("git", ["clone", "-q", bareRemote, appDir]);

    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { build: "echo BUILD-RAN" } }),
    );
    spawnSync("git", ["-C", appDir, "add", "-A"]);
    spawnSync("git", ["-C", appDir, "commit", "-q", "-m", "baseline"]);
    spawnSync("git", ["-C", appDir, "push", "-q", "origin", "main"]);
    const baseline = spawnSync("git", ["-C", appDir, "rev-parse", "HEAD"]).stdout.toString().trim();
    fs.writeFileSync(path.join(appDir, ".deploy-state"), baseline);

    // A change that costs a build without costing an install, so the run
    // reaches the build step without needing a real `npm ci`.
    fs.writeFileSync(path.join(appDir, "lib-marker.ts"), "// touch");
    spawnSync("git", ["-C", appDir, "add", "-A"]);
    spawnSync("git", ["-C", appDir, "commit", "-q", "-m", "build-worthy change"]);
    spawnSync("git", ["-C", appDir, "push", "-q", "origin", "main"]);

    const configPath = path.join(appDir, "config.json");
    fs.writeFileSync(configPath, "{}");
    fs.chmodSync(configPath, 0o000);

    try {
      const failure = await run("bash", [script], {
        env: {
          ...process.env,
          APP_DIR: appDir,
          RUN_AS: os.userInfo().username,
          FERNSCOUT_CONFIG: configPath,
          PORT: "18174",
        },
      }).catch((e) => e);

      expect(failure).toMatchObject({ code: 1, stderr: expect.stringContaining("is not readable by") });
      // The build script would have printed this if `npm run build` ever ran.
      expect(failure.stdout + failure.stderr).not.toContain("BUILD-RAN");
    } finally {
      fs.chmodSync(configPath, 0o644);
    }
  });
});
