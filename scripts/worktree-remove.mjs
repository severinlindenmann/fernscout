#!/usr/bin/env node
// `npm run worktree:remove <branch>` — tears down what `worktree:new` (and
// bootstrap's own paid worktree step) built: the nested `<wt>/paid` worktree,
// then the app worktree, then both branches if they are merged into their
// repo's `main` (refuses an unmerged branch without --force — the worktree
// itself still comes down either way, matching `git worktree remove`'s own
// "uncommitted changes" guard). B2710: nothing tore these down before, and
// merged worktrees' `.next` directories alone had filled a disk.
//
//   npm run worktree:remove -- <branch> [--force]

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = process.argv.slice(2);
const force = args.includes("--force");
const branch = args.find((a) => !a.startsWith("--"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!branch) fail("Usage: npm run worktree:remove -- <branch> [--force]");
if (!fs.existsSync(path.join(root, ".git")) || fs.statSync(path.join(root, ".git")).isFile()) {
  fail("Run this from the shared checkout root.");
}

const target = path.join(root, ".claude", "worktrees", branch);
if (!fs.existsSync(target)) fail(`${target} does not exist.`);

const mainPaid = path.join(root, "paid");
const targetPaid = path.join(target, "paid");

function removeWorktree(repoDir, worktreePath) {
  const result = spawnSync(
    "git",
    ["-C", repoDir, "worktree", "remove", ...(force ? ["--force"] : []), worktreePath],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    fail(
      (result.stderr || result.stdout || `Could not remove the worktree at ${worktreePath}.`) +
        (force ? "" : "\nPass --force to remove it even with uncommitted changes."),
    );
  }
  console.log(`Removed the worktree at ${worktreePath}.`);
}

function deleteBranchIfMerged(repoDir, branchName) {
  const branchExists =
    spawnSync("git", ["-C", repoDir, "rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`]).status === 0;
  if (!branchExists) return;
  const merged = spawnSync("git", ["-C", repoDir, "branch", "--merged", "main", "--list", branchName], {
    encoding: "utf8",
  });
  const isMerged = merged.stdout.trim().length > 0;
  if (!isMerged && !force) {
    console.warn(`Branch ${branchName} in ${repoDir} is not merged into main; kept (pass --force to delete it anyway).`);
    return;
  }
  const deleted = spawnSync("git", ["-C", repoDir, "branch", isMerged ? "-d" : "-D", branchName], { encoding: "utf8" });
  if (deleted.status !== 0) fail(deleted.stderr || deleted.stdout || `Could not delete branch ${branchName} in ${repoDir}.`);
  console.log(`Deleted branch ${branchName} in ${repoDir}.`);
}

if (fs.existsSync(targetPaid)) removeWorktree(mainPaid, targetPaid);
removeWorktree(root, target);

deleteBranchIfMerged(root, branch);
if (fs.existsSync(mainPaid)) deleteBranchIfMerged(mainPaid, branch);

spawnSync("git", ["-C", root, "worktree", "prune"]);
if (fs.existsSync(mainPaid)) spawnSync("git", ["-C", mainPaid, "worktree", "prune"]);
