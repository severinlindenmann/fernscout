#!/usr/bin/env node
// `npm run worktree:new <branch>` — the one hand-written chain
// (`git worktree add .claude/worktrees/<branch> -b <branch>` then
// `npm run worktree:bootstrap`) folded into a command, run from the shared
// checkout. B2710: this chain had been typed out sixteen times across recent
// sessions.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const branch = process.argv[2];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!branch) fail("Usage: npm run worktree:new -- <branch>");
if (!fs.existsSync(path.join(root, ".git")) || fs.statSync(path.join(root, ".git")).isFile()) {
  fail("Run this from the shared checkout root (a linked worktree cannot create another).");
}

const target = path.join(root, ".claude", "worktrees", branch);
if (fs.existsSync(target)) fail(`${target} already exists.`);

const added = spawnSync("git", ["worktree", "add", target, "-b", branch], { cwd: root, stdio: "inherit" });
if (added.status !== 0) process.exit(added.status ?? 1);

const bootstrapped = spawnSync("npm", ["run", "worktree:bootstrap"], { cwd: target, stdio: "inherit" });
if (bootstrapped.status !== 0) process.exit(bootstrapped.status ?? 1);

console.log(`\n${target}`);
