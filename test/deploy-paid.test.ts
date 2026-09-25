import { afterEach, describe, expect, test } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * B2247: `scripts/deploy.sh` learns about the open-core split's private
 * features tree (`paid/`) — uploaded by `.claude/skills/vps/ship.sh`, never
 * pulled by the box itself.
 *
 * Four things matter here, each silent if it breaks:
 *   - a paid feature switched on with no `paid/` to satisfy it must refuse,
 *     but only once the split has actually landed (`lib/paid-stubs/` exists) —
 *     otherwise every deploy of today's fernscout.ch (photobook, postcards,
 *     whatsapp and credits all on, no `paid/` anywhere yet) would refuse
 *     itself out of existence;
 *   - a `paid/`-only push (the app repo unchanged, already "at HEAD") must
 *     still cost a build + restart — the one case the app's own if/elif/else
 *     chain cannot see, because its `else` never runs when there is nothing
 *     for it to diff;
 *   - a live commit this checkout's history does not contain must fall back
 *     to a full deploy, not a hard `git diff` failure under `set -e`.
 *
 * Real invocations of `bash scripts/deploy.sh` against a throwaway checkout,
 * the same shape `test/deploy-swap.test.ts` and `test/deploy-guards.test.ts`
 * already use — not a reimplementation of the script's logic in TypeScript.
 */

const run = promisify(execFile);
const script = path.join(process.cwd(), "scripts", "deploy.sh");
const checkBuild = path.join(process.cwd(), "scripts", "check-build.mjs");

const dirs: string[] = [];
const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-paid-"));
  dirs.push(dir);
  return dir;
}
function git(...args: string[]) {
  const done = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args]);
  if (done.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr}`);
  return done.stdout.toString().trim();
}

// A build that never touches .next in place and leaves a finished page in
// NEXT_DIST_DIR — the same stub test/deploy-swap.test.ts drives check-build.mjs
// with.
const BUILD_STUB = `
const fs = require("fs"), path = require("path");
const dist = process.env.NEXT_DIST_DIR || ".next";
fs.appendFileSync(process.env.LOG, "build dist=" + dist + "\\n");
const app = path.join(dist, "server/app");
fs.mkdirSync(app, { recursive: true });
fs.writeFileSync(path.join(app, "page.js"), "");
fs.writeFileSync(path.join(app, "page_client-reference-manifest.js"), "");
`;

// systemctl: logs each call, and on start/restart makes the stub health
// server answer the commit and paid/ SHA now checked out.
const SYSTEMCTL_STUB = `#!/usr/bin/env bash
case "$1" in
  is-active) exit 0 ;;
  is-enabled) exit 1 ;;
esac
echo "systemctl $*" >> "$LOG"
case "$1" in
  start|restart)
    git -C "$APP_DIR" rev-parse HEAD > "$APP_DIR/.served"
    [ -f "$APP_DIR/paid/.sha" ] && cp "$APP_DIR/paid/.sha" "$APP_DIR/.servedPaid"
    ;;
esac
`;

/**
 * A throwaway checkout with a stub build, a stub sudo/systemctl and a stub
 * /api/health — already "deployed" at its own HEAD and healthy, exactly like
 * a quiet instance that has not changed since its last deploy.
 *
 * `configFeatures` becomes `site/config.json`'s `features` block, read
 * through `FERNSCOUT_CONFIG`. `withPaidStubs` creates `lib/paid-stubs/`,
 * which is the split-has-landed marker the gate is keyed on.
 */
async function fixture(opts: { configFeatures?: object; withPaidStubs?: boolean } = {}) {
  const appDir = tmp();
  const remote = tmp();
  const bin = tmp();
  const unitDir = tmp();
  const systemdDir = tmp();
  const log = path.join(tmp(), "log");
  fs.writeFileSync(log, "");

  git("init", "-q", "--bare", "-b", "main", remote);
  git("clone", "-q", remote, appDir);
  fs.mkdirSync(path.join(appDir, "scripts"));
  fs.copyFileSync(checkBuild, path.join(appDir, "scripts", "check-build.mjs"));
  fs.writeFileSync(path.join(appDir, "build-stub.js"), BUILD_STUB);
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { build: "node build-stub.js" } }),
  );
  // A minimal but real lockfile — `npm ci` refuses to run without one, and a
  // full-plan deploy (the "unknown live commit" scenario) reaches do_install.
  fs.writeFileSync(
    path.join(appDir, "package-lock.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "fixture", version: "1.0.0" } },
    }),
  );

  const configPath = path.join(appDir, "site-config.json");
  fs.writeFileSync(configPath, JSON.stringify({ features: opts.configFeatures ?? {} }));

  if (opts.withPaidStubs) fs.mkdirSync(path.join(appDir, "lib", "paid-stubs"), { recursive: true });

  fs.writeFileSync(path.join(appDir, ".gitignore"), ".next*\n.served*\n.deploy*\nsite-config.json\n");
  git("-C", appDir, "add", "-A");
  git("-C", appDir, "commit", "-q", "-m", "baseline");
  git("-C", appDir, "push", "-q", "origin", "main");
  const baseline = git("-C", appDir, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(appDir, ".served"), baseline);

  fs.mkdirSync(path.join(appDir, ".next", "cache"), { recursive: true });
  fs.mkdirSync(path.join(appDir, ".next", "types"));
  fs.writeFileSync(path.join(appDir, ".next", "marker"), "old");

  // A unit source and a writable fake /etc/systemd/system, so a full plan's
  // do_units step (reached by the "unknown commit" scenario below) succeeds
  // without touching the real machine.
  fs.writeFileSync(
    path.join(unitDir, "fernscout.service"),
    "[Unit]\nDescription=fixture\n[Service]\nExecStart=/bin/true\n",
  );

  fs.writeFileSync(path.join(bin, "sudo"), '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "systemctl"), SYSTEMCTL_STUB, { mode: 0o755 });

  const server = http.createServer((_req, res) => {
    const commit = fs.readFileSync(path.join(appDir, ".served"), "utf8").trim();
    const servedPaidPath = path.join(appDir, ".servedPaid");
    const paidCommit = fs.existsSync(servedPaidPath)
      ? fs.readFileSync(servedPaidPath, "utf8").trim()
      : null;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, commit, paidCommit }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    APP_DIR: appDir,
    RUN_AS: os.userInfo().username,
    ENV_FILE: path.join(appDir, "no-env"),
    PORT: String(port),
    LOG: log,
    FERNSCOUT_CONFIG: configPath,
    UNIT_SRC: unitDir,
    SYSTEMD_DIR: systemdDir,
  };
  delete env.HEALTH_TOKEN;
  delete env.NEXT_DIST_DIR;
  return { appDir, env, readLog: () => fs.readFileSync(log, "utf8") };
}

describe("B2247: a paid feature with no paid/ tree", () => {
  test("refuses once the split has landed (lib/paid-stubs/ present)", async () => {
    const { env } = await fixture({
      configFeatures: { photobook: { enabled: true } },
      withPaidStubs: true,
    });
    const failure = await run("bash", [script], { env }).catch((e) => e);
    expect(failure).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("asks for a paid feature but"),
    });
  });

  test("no paid feature requested deploys exactly as before", async () => {
    const { env } = await fixture({ configFeatures: {}, withPaidStubs: true });
    const result = await run("bash", [script], { env }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code ?? 0, out).toBe(0);
    expect(out).not.toContain("asks for a paid feature");
  });
});

describe("B2247: the gate is inert before the split lands", () => {
  test("today's fernscout.ch (paid features on, no lib/paid-stubs/) deploys unchanged", async () => {
    // The exact shape of the live instance on 2026-09-25: photobook, postcards,
    // whatsapp and credits all on, and no paid/ anywhere — this must not
    // start refusing the moment this ticket merges, before ship.sh or the
    // split itself exist.
    const { env } = await fixture({
      configFeatures: {
        photobook: { enabled: true },
        postcards: { enabled: true },
        whatsapp: { enabled: true },
        credits: { enabled: true },
      },
      withPaidStubs: false,
    });
    const result = await run("bash", [script], { env }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code ?? 0, out).toBe(0);
    expect(out).not.toContain("asks for a paid feature");
  });
});

describe("B2247: a paid/-only push still costs a build", () => {
  test("build + restart even though the app itself is already at HEAD", async () => {
    const { appDir, env, readLog } = await fixture({ configFeatures: {} });
    fs.mkdirSync(path.join(appDir, "paid"));
    fs.writeFileSync(path.join(appDir, "paid", ".sha"), "b".repeat(40));
    // The box's own record of what it last served: an older paid/ SHA.
    fs.writeFileSync(path.join(appDir, ".servedPaid"), "a".repeat(40));

    const result = await run("bash", [script], { env }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code ?? 0, out).toBe(0);
    expect(out).toContain("already at");
    expect(out).toContain("paid/ changed since");
    expect(out).toContain("will build");
    expect(out).toContain("will restart");
    expect(readLog()).toContain("build dist=.next-build");
  }, 60_000);

  test("an unchanged paid/ SHA costs nothing extra", async () => {
    const { appDir, env, readLog } = await fixture({ configFeatures: {} });
    fs.mkdirSync(path.join(appDir, "paid"));
    fs.writeFileSync(path.join(appDir, "paid", ".sha"), "a".repeat(40));
    fs.writeFileSync(path.join(appDir, ".servedPaid"), "a".repeat(40));

    const result = await run("bash", [script], { env }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code ?? 0, out).toBe(0);
    expect(out).toContain("nothing to do");
    expect(out).not.toContain("paid/ changed since");
    expect(readLog()).not.toContain("build dist=");
  });
});

describe("B2247: a live commit this checkout does not have falls back to a full deploy", () => {
  test("deploys in full rather than failing on git diff", async () => {
    const { env, appDir } = await fixture({ configFeatures: {} });
    // /api/health reports a commit no history here ever had — the shape a
    // cutover or a reused, rolled-back checkout leaves behind.
    fs.writeFileSync(path.join(appDir, ".served"), "f".repeat(40));

    const result = await run("bash", [script], { env }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(out).toContain("this checkout has no such commit — deploying in full");
    expect(out).toContain("no record of a previous deploy — doing everything once");
    // Never the raw git failure `set -euo pipefail` would otherwise surface.
    expect(out).not.toContain("fatal: bad object");
  }, 60_000);
});
