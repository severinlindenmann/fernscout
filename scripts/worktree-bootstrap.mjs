#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { assertRepositoryNode } from "./runtime-preflight.mjs";
import { lockfileHash, parseWorktreeList } from "./worktree-bootstrap-lib.mjs";

const root = process.cwd();
const modules = path.join(root, "node_modules");
const lockfile = path.join(root, "package-lock.json");
const lockStamp = path.join(modules, ".fernscout-package-lock.sha256");
const refresh = process.argv.includes("--refresh");

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

assertRepositoryNode(root);

if (!fs.existsSync(path.join(root, ".git"))) fail("Run this command from a Fernscout checkout root.");
if (fs.statSync(path.join(root, ".git")).isDirectory()) {
  fail("This is the shared checkout, not a linked worktree; it does not need bootstrapping.");
}

const listed = run("git", ["worktree", "list", "--porcelain"]);
if (listed.status !== 0) fail(listed.stderr || "Could not inspect git worktrees.");
const main = parseWorktreeList(listed.stdout).find((entry) => entry.branch === "refs/heads/main");
if (!main?.worktree) fail("Could not find the shared checkout on branch main.");

const source = path.join(main.worktree, "node_modules");
if (!fs.existsSync(path.join(source, "next", "package.json"))) {
  fail(`The shared checkout has no usable node_modules at ${source}; run npm ci there first.`);
}

const expectedHash = lockfileHash(lockfile);
let replaceModules = false;
if (fs.existsSync(modules)) {
  const stampedHash = fs.existsSync(lockStamp) ? fs.readFileSync(lockStamp, "utf8").trim() : null;
  if (stampedHash === expectedHash) {
    console.log(`Worktree dependencies already match package-lock.json (Node ${process.versions.node}).`);
    process.exit(0);
  }
  if (!refresh) {
    fail(
      "This worktree already has node_modules, but its package-lock provenance is missing or stale.\n" +
        "Run `npm run worktree:bootstrap -- --refresh` to replace only this worktree's dependency clone.",
    );
  }
  replaceModules = true;
}

const sourceCheck = spawnSync("npm", ["ls", "--depth=0"], {
  cwd: main.worktree,
  encoding: "utf8",
});
const cloneSourceIsValid = sourceCheck.status === 0;
if (!cloneSourceIsValid) {
  console.warn(
    "The shared checkout's dependencies are stale, so this worktree will use npm ci instead of cloning them.\n" +
      `${sourceCheck.stderr || sourceCheck.stdout}`,
  );
}

const started = Date.now();
const useCopyOnWriteClone = process.platform === "darwin" && cloneSourceIsValid;
if (replaceModules && useCopyOnWriteClone) fs.rmSync(modules, { recursive: true, force: true });
const copied = useCopyOnWriteClone
  ? spawnSync("cp", ["-Rc", source, modules], { encoding: "utf8" })
  : spawnSync("npm", ["ci", "--prefer-offline"], { cwd: root, encoding: "utf8" });
if (copied.status !== 0) fail(copied.stderr || copied.stdout || "Dependency bootstrap failed.");

fs.writeFileSync(lockStamp, `${expectedHash}\n`);
const installedNext = JSON.parse(fs.readFileSync(path.join(modules, "next", "package.json"), "utf8")).version;
console.log(
  `Bootstrapped this worktree in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
    `with Node ${process.versions.node} and Next ${installedNext} ` +
    `(${useCopyOnWriteClone ? "APFS clone" : "npm ci"}).`,
);
