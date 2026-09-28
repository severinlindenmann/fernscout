import { afterEach, describe, expect, test } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * B2230: a deploy builds beside the .next that is serving, and swaps it in
 * only while the service is stopped.
 *
 * On 2026-09-24 `npm run build` rewrote .next under the running server and
 * pages answered 500 (ChunkLoadError, missing client reference manifest) for
 * about a minute before the restart. This drives the real `scripts/deploy.sh`
 * against a throwaway checkout with a stub build, a stub `sudo`/`systemctl`
 * and a stub /api/health, and reads what each step saw of the disk.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-swap-"));
  dirs.push(dir);
  return dir;
}
function git(...args: string[]) {
  const done = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args]);
  if (done.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr}`);
  return done.stdout.toString().trim();
}

// The build: records what it could see, refuses to write into .next, and
// leaves a finished page in NEXT_DIST_DIR — or fails, when BUILD_FAILS is set.
const BUILD_STUB = `
const fs = require("fs"), path = require("path");
const dist = process.env.NEXT_DIST_DIR || ".next";
const seen = (p) => fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "-";
fs.appendFileSync(process.env.LOG, [
  "build dist=" + dist,
  "serving=" + seen(".next/marker"),
  "cache=" + seen(path.join(dist, "cache/turbo")),
  "oldTypes=" + (fs.existsSync(".next/types") ? "present" : "gone"),
].join(" ") + "\\n");
if (process.env.BUILD_FAILS) process.exit(1);
if (dist === ".next") { console.error("built in place"); process.exit(1); }
const app = path.join(dist, "server/app");
fs.mkdirSync(app, { recursive: true });
fs.writeFileSync(path.join(app, "page.js"), "");
fs.writeFileSync(path.join(app, "page_client-reference-manifest.js"), "");
fs.writeFileSync(path.join(dist, "marker"), "new");
`;

// systemctl: logs each call with the state of the three directories, and on
// start/restart makes the stub health answer the commit now checked out.
const SYSTEMCTL_STUB = `#!/usr/bin/env bash
case "$1" in is-active|is-enabled) exit 1 ;; esac
m() { cat "$APP_DIR/$1/marker" 2>/dev/null || echo -; }
echo "systemctl $* next=$(m .next) prev=$(m .next-prev) build=$(m .next-build)" >> "$LOG"
case "$1" in start|restart) git -C "$APP_DIR" rev-parse HEAD > "$APP_DIR/.served" ;; esac
`;

type Options = {
  pageStatus?: number;
  /** The build-worthy path the pushed commit changes. */
  change?: string;
  /** B2556: /api/health answers 503 while the new commit is the one serving. */
  newIsUnhealthy?: boolean;
  /** B2556: a paid/ tree uploaded for this deploy, the served one kept beside it. */
  paid?: boolean;
};

async function fixture(pageStatusOrOptions: number | Options = 200) {
  const opts: Options =
    typeof pageStatusOrOptions === "number" ? { pageStatus: pageStatusOrOptions } : pageStatusOrOptions;
  const pageStatus = opts.pageStatus ?? 200;
  const appDir = tmp();
  const remote = tmp();
  const bin = tmp();
  const log = path.join(tmp(), "log");
  fs.writeFileSync(log, "");

  git("init", "-q", "--bare", "-b", "main", remote);
  git("clone", "-q", remote, appDir);
  fs.mkdirSync(path.join(appDir, "scripts"));
  fs.copyFileSync(checkBuild, path.join(appDir, "scripts", "check-build.mjs"));
  fs.writeFileSync(path.join(appDir, "build-stub.js"), BUILD_STUB);
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: { build: "node build-stub.js", "db:migrate": "node -e 0" },
    }),
  );
  fs.writeFileSync(path.join(appDir, ".gitignore"), ".next*\n.served\n.deploy*\npaid/\npaid.failed/\n");
  git("-C", appDir, "add", "-A");
  git("-C", appDir, "commit", "-q", "-m", "baseline");
  git("-C", appDir, "push", "-q", "origin", "main");
  const baseline = git("-C", appDir, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(appDir, ".served"), baseline);

  // A build-worthy change, pushed but not yet pulled.
  const change = opts.change ?? "lib-marker.ts";
  fs.mkdirSync(path.dirname(path.join(appDir, change)), { recursive: true });
  fs.writeFileSync(path.join(appDir, change), "// touch");
  git("-C", appDir, "add", "-A");
  git("-C", appDir, "commit", "-q", "-m", "change");
  git("-C", appDir, "push", "-q", "origin", "main");
  const next = git("-C", appDir, "rev-parse", "HEAD");
  git("-C", appDir, "reset", "-q", "--hard", baseline);

  if (opts.paid) {
    // What the CI wrapper leaves: the new upload in paid/, the served one
    // beside the checkout, and the served paid SHA on record.
    fs.mkdirSync(path.join(appDir, "paid"));
    fs.writeFileSync(path.join(appDir, "paid", ".sha"), "b".repeat(40));
    fs.mkdirSync(`${appDir}.paid-prev`);
    dirs.push(`${appDir}.paid-prev`);
    fs.writeFileSync(path.join(`${appDir}.paid-prev`, ".sha"), "a".repeat(40));
    fs.writeFileSync(path.join(appDir, ".deploy-state-paid"), "a".repeat(40));
  }

  // The build that is serving right now, with its cache and route types.
  fs.mkdirSync(path.join(appDir, ".next", "cache"), { recursive: true });
  fs.mkdirSync(path.join(appDir, ".next", "types"));
  fs.writeFileSync(path.join(appDir, ".next", "marker"), "old");
  fs.writeFileSync(path.join(appDir, ".next", "cache", "turbo"), "warm");

  fs.writeFileSync(path.join(bin, "sudo"), '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "systemctl"), SYSTEMCTL_STUB, { mode: 0o755 });
  // B2557: records the scope it was asked for, then runs what runuser would.
  fs.writeFileSync(
    path.join(bin, "systemd-run"),
    '#!/usr/bin/env bash\necho "systemd-run $*" >> "$LOG"\nwhile [ "$1" != -- ]; do shift; done\nshift\nexec "$@"\n',
    { mode: 0o755 },
  );

  const server = http.createServer((req, res) => {
    // B2525: the rewritten page the deploy asks for after /api/health.
    if (req.url?.startsWith("/@")) {
      res.statusCode = pageStatus;
      return res.end();
    }
    const commit = fs.readFileSync(path.join(appDir, ".served"), "utf8").trim();
    if (opts.newIsUnhealthy && commit === next) {
      res.statusCode = 503;
      return res.end();
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, commit }));
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
    DEPLOY_HEALTH_WAIT: "3",
  };
  delete env.HEALTH_TOKEN;
  delete env.NEXT_DIST_DIR;
  delete env.FERNSCOUT_CONFIG;
  delete env.DATABASE_URL;
  delete env.DEPLOY_SCOPE_UID;
  delete env.SERVICE;
  return { appDir, env, baseline, next, readLog: () => fs.readFileSync(log, "utf8") };
}

const marker = (dir: string) =>
  fs.existsSync(path.join(dir, "marker")) ? fs.readFileSync(path.join(dir, "marker"), "utf8") : null;

describe("B2230: the build never touches the .next that is serving", () => {
  test("builds into .next-build, swaps only while stopped, keeps one generation back", async () => {
    const { appDir, env, readLog } = await fixture();
    const result = await run("bash", [script], { env }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code ?? 0, out).toBe(0);
    expect(out).toContain("healthy");

    const log = readLog();
    // The build ran beside the old one, with the warm cache moved over and the
    // old route types out of its type check, while the old build still served.
    expect(log).toContain("build dist=.next-build serving=old cache=warm oldTypes=gone");
    // Stopped with the old build still in place; started on the new one.
    expect(log).toContain("systemctl stop fernscout next=old prev=- build=new");
    expect(log).toMatch(/systemctl restart fernscout next=new prev=old build=-/);
    expect(log.indexOf("systemctl stop")).toBeLessThan(log.indexOf("systemctl restart"));

    expect(marker(path.join(appDir, ".next"))).toBe("new");
    expect(marker(path.join(appDir, ".next-prev"))).toBe("old");
    expect(fs.existsSync(path.join(appDir, ".next-build"))).toBe(false);
    // Nothing the build did left the checkout dirty for the next pull.
    expect(git("-C", appDir, "status", "--porcelain")).toBe("");
  }, 60_000);

  test("a cache over DEPLOY_CACHE_MAX_GB is dropped, not carried, and the build runs cold", async () => {
    const { appDir, env, readLog } = await fixture();
    const result = await run("bash", [script], { env: { ...env, DEPLOY_CACHE_MAX_GB: "0" } }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code ?? 0, out).toBe(0);
    expect(out).toContain("turbopack cache 0 GB > 0 GB — building cold");
    expect(readLog()).toContain("build dist=.next-build serving=old cache=- oldTypes=gone");
    // Gone, not parked in .next-prev where it would sit until the next deploy.
    expect(fs.existsSync(path.join(appDir, ".next-prev", "cache"))).toBe(false);
    expect(fs.existsSync(path.join(appDir, ".next", "cache"))).toBe(false);
  }, 60_000);

  test("a failed build leaves the serving .next alone and never stops the service", async () => {
    const { appDir, env, readLog } = await fixture();
    const result = await run("bash", [script], { env: { ...env, BUILD_FAILS: "1" } }).catch((e) => e);
    expect(result.code).toBe(1);

    expect(readLog()).not.toContain("systemctl");
    expect(marker(path.join(appDir, ".next"))).toBe("old");
    expect(fs.existsSync(path.join(appDir, ".next-prev"))).toBe(false);
  }, 60_000);

  test("B2525: healthy /api/health but a 500 on a rewritten page fails the deploy unrecorded", async () => {
    const { appDir, env } = await fixture(500);
    const result = await run("bash", [script], { env }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code, out).toBe(1);
    expect(out).toContain("/@example answered 500");
    expect(fs.existsSync(path.join(appDir, ".deploy-state"))).toBe(false);
  }, 60_000);

  test("B2525: a 404 on the rewritten page still passes — that journal need not exist", async () => {
    const { env } = await fixture(404);
    const result = await run("bash", [script], { env }).catch((e) => e);
    expect(result.code ?? 0, String(result.stdout) + String(result.stderr)).toBe(0);
  }, 60_000);
});

describe("B2556: a restart that fails its checks goes back to the build that served", () => {
  test("health never answers on the new build: previous build and commit serve again, exit 1", async () => {
    const { appDir, env, baseline, next } = await fixture({ newIsUnhealthy: true, paid: true });
    const result = await run("bash", [script], { env }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code, out).toBe(1);
    expect(out).toContain("did not become healthy in 3s");
    expect(out).toContain(`rolled back to ${baseline}`);

    expect(marker(path.join(appDir, ".next"))).toBe("old");
    expect(marker(path.join(appDir, ".next-failed"))).toBe("new");
    expect(fs.existsSync(path.join(appDir, ".next-prev"))).toBe(false);
    expect(git("-C", appDir, "rev-parse", "HEAD")).toBe(baseline);
    expect(fs.readFileSync(path.join(appDir, ".served"), "utf8").trim()).toBe(baseline);
    expect(baseline).not.toBe(next);
    // The paid/ tree that served is back, the failed upload kept beside it.
    expect(fs.readFileSync(path.join(appDir, "paid", ".sha"), "utf8")).toBe("a".repeat(40));
    expect(fs.readFileSync(path.join(appDir, "paid.failed", ".sha"), "utf8")).toBe("b".repeat(40));
    expect(fs.existsSync(`${appDir}.paid-prev`)).toBe(false);
    // A rollback is not a deploy: nothing recorded.
    expect(fs.existsSync(path.join(appDir, ".deploy-state"))).toBe(false);
  }, 60_000);

  test("a 5xx on /@example after the restart also rolls back", async () => {
    const { appDir, env, baseline } = await fixture(502);
    const result = await run("bash", [script], { env }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code, out).toBe(1);
    expect(out).toContain("/@example answered 502");
    expect(out).toContain(`rolled back to ${baseline}`);
    expect(marker(path.join(appDir, ".next"))).toBe("old");
    expect(git("-C", appDir, "rev-parse", "HEAD")).toBe(baseline);
  }, 60_000);

  test("a deploy that ran migrations is not rolled back, and says why", async () => {
    const { appDir, env, next } = await fixture({
      newIsUnhealthy: true,
      change: "lib/db/migrations/0001_x.sql",
    });
    const result = await run("bash", [script], { env: { ...env, DATABASE_URL: "postgres://stub/none" } }).catch(
      (e) => e,
    );
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code, out).toBe(1);
    expect(out).toContain("NOT ROLLING BACK: this deploy ran database migrations");
    expect(out).not.toContain("rolled back to");
    expect(marker(path.join(appDir, ".next"))).toBe("new");
    expect(git("-C", appDir, "rev-parse", "HEAD")).toBe(next);
  }, 60_000);
});

describe("B2557: a dev build runs in a CPU-limited scope, prod's does not", () => {
  test("dev, as root with systemd-run: every build goes through the transient scope", async () => {
    const { env, readLog } = await fixture();
    const result = await run("bash", [script], {
      env: { ...env, SERVICE: "fernscout-dev", DEPLOY_SCOPE_UID: "0" },
    }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code ?? 0, out).toBe(0);
    expect(out).toContain("building fernscout-dev in a transient scope (systemd-run, CPUQuota=200%, nice 10)");
    expect(readLog()).toContain(
      `systemd-run --scope --quiet -p CPUQuota=200% nice -n 10 runuser -u ${env.RUN_AS} -- env NEXT_DIST_DIR=.next-build npm run build`,
    );
  }, 60_000);

  test("dev without root: the build runs plain and the log says so", async () => {
    const { env, readLog } = await fixture();
    const result = await run("bash", [script], { env: { ...env, SERVICE: "fernscout-dev" } }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code ?? 0, out).toBe(0);
    expect(out).toContain("building fernscout-dev without a CPU scope");
    expect(readLog()).not.toContain("systemd-run");
    expect(readLog()).toContain("build dist=.next-build");
  }, 60_000);

  test("prod never takes the scope, even as root with systemd-run", async () => {
    const { env, readLog } = await fixture();
    const result = await run("bash", [script], { env: { ...env, DEPLOY_SCOPE_UID: "0" } }).catch((e) => e);
    const out = String(result.stdout) + String(result.stderr);
    expect(result.code ?? 0, out).toBe(0);
    expect(out).not.toContain("scope");
    expect(readLog()).not.toContain("systemd-run");
  }, 60_000);
});
