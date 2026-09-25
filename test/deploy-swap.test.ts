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

async function fixture() {
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
    JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { build: "node build-stub.js" } }),
  );
  fs.writeFileSync(path.join(appDir, ".gitignore"), ".next*\n.served\n.deploy*\n");
  git("-C", appDir, "add", "-A");
  git("-C", appDir, "commit", "-q", "-m", "baseline");
  git("-C", appDir, "push", "-q", "origin", "main");
  const baseline = git("-C", appDir, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(appDir, ".served"), baseline);

  // A build-worthy change, pushed but not yet pulled.
  fs.writeFileSync(path.join(appDir, "lib-marker.ts"), "// touch");
  git("-C", appDir, "add", "-A");
  git("-C", appDir, "commit", "-q", "-m", "change");
  git("-C", appDir, "push", "-q", "origin", "main");
  git("-C", appDir, "reset", "-q", "--hard", baseline);

  // The build that is serving right now, with its cache and route types.
  fs.mkdirSync(path.join(appDir, ".next", "cache"), { recursive: true });
  fs.mkdirSync(path.join(appDir, ".next", "types"));
  fs.writeFileSync(path.join(appDir, ".next", "marker"), "old");
  fs.writeFileSync(path.join(appDir, ".next", "cache", "turbo"), "warm");

  fs.writeFileSync(path.join(bin, "sudo"), '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "systemctl"), SYSTEMCTL_STUB, { mode: 0o755 });

  const server = http.createServer((_req, res) => {
    const commit = fs.readFileSync(path.join(appDir, ".served"), "utf8").trim();
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
  };
  delete env.HEALTH_TOKEN;
  delete env.NEXT_DIST_DIR;
  delete env.FERNSCOUT_CONFIG;
  return { appDir, env, readLog: () => fs.readFileSync(log, "utf8") };
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
});
