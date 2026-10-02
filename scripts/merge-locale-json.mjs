#!/usr/bin/env node
// Git merge driver for site/locales/*.json — B2712.
//
// Every merge of `origin/main` into a feature branch that touched the same
// locale file conflicted (4x in one branch, 8addee91), and agents hand-wrote
// a 3-way merge in Python instead of the rule AGENTS.md already states: a
// key both sides only added is kept from both; a key both sides changed to
// different values keeps main's. This script is that rule, wired in as a
// `.gitattributes` merge driver so `git merge`/`rebase` resolves it without
// a person or an agent touching the file by hand.
//
// Registered via `git config merge.localejson.driver` (scripts/worktree-bootstrap.mjs)
// and `.gitattributes` (`site/locales/*.json merge=localejson`). Git invokes
// a driver as `<driver> %O %A %B` — three temp file paths holding the common
// ancestor, "ours" and "theirs" — and expects the resolved content written
// back into %A's file; a non-zero exit leaves conflict markers instead.
//
// Which side is "main" — the deciding factor for a real conflict — depends
// on merge direction. The run this driver exists for is `git merge
// origin/main` from inside a feature branch (AGENTS.md's own worktree
// instructions: "ff its paid/" and "merge origin/main in the app worktree"),
// so HEAD ("ours", %A) is the feature branch and MERGE_HEAD ("theirs", %B)
// is main — the common case this driver optimises for. `detectMainSide`
// below confirms that from the repository itself (current branch, or
// MERGE_HEAD against origin/main) when it can; when it cannot tell — no
// MERGE_HEAD, no origin/main, a rebase instead of a merge — it falls back to
// "theirs", documented here rather than left to guess silently later.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

function readJson(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  return text ? JSON.parse(text) : {};
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null; // e.g. no MERGE_HEAD/origin/main — a normal, silent "can't tell"
  }
}

/** @returns {"ours" | "theirs"} */
export function detectMainSide() {
  if (git(["rev-parse", "--abbrev-ref", "HEAD"]) === "main") return "ours";
  const mergeHead = git(["rev-parse", "MERGE_HEAD"]);
  const originMain = git(["rev-parse", "origin/main"]);
  if (mergeHead && originMain && mergeHead === originMain) return "theirs";
  return "theirs"; // undeterminable — the common case (merging main in) wins by default
}

/**
 * Pure 3-way merge of three flat `{key: string}` locale dictionaries.
 * `mainSide` picks the winner only where both sides changed the same key to
 * different values; every other case has one unambiguous answer:
 *   - unchanged on one side → take the other side's value (incl. deletion).
 *   - added on only one side (absent from the ancestor) → keep it.
 *   - deleted on both sides → stays gone.
 *
 * @param {Record<string, string>} ancestor
 * @param {Record<string, string>} ours
 * @param {Record<string, string>} theirs
 * @param {{ mainSide?: "ours" | "theirs" }} [options]
 * @returns {Record<string, string>}
 */
export function mergeLocaleJson(ancestor, ours, theirs, { mainSide = "theirs" } = {}) {
  const result = {};
  const order = [...Object.keys(ours), ...Object.keys(theirs).filter((k) => !(k in ours))];
  for (const key of order) {
    const inO = Object.prototype.hasOwnProperty.call(ancestor, key);
    const inA = Object.prototype.hasOwnProperty.call(ours, key);
    const inB = Object.prototype.hasOwnProperty.call(theirs, key);
    const o = ancestor[key];
    const a = ours[key];
    const b = theirs[key];

    if (inA && inB) {
      if (a === b || !inO || o === a) {
        result[key] = b; // identical, both added it fresh, or only B changed it
      } else if (o === b) {
        result[key] = a; // only A changed it
      } else {
        result[key] = mainSide === "ours" ? a : b; // both changed it differently — main wins
      }
    } else if (inA && !inB) {
      if (!inO) result[key] = a; // A added it alone
      else if (o !== a && mainSide === "ours") result[key] = a; // A edited, B deleted, A is main
      // else: B's deletion wins
    } else if (inB && !inA) {
      if (!inO) result[key] = b; // B added it alone
      else if (o !== b && mainSide === "theirs") result[key] = b; // B edited, A deleted, B is main
      // else: A's deletion wins
    }
    // neither side has it — stays gone
  }
  return result;
}

// --- CLI entry point — invoked by git as `merge-locale-json.mjs %O %A %B` ---
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [, , ancestorPath, oursPath, theirsPath] = process.argv;
  if (!ancestorPath || !oursPath || !theirsPath) {
    console.error("Usage: merge-locale-json.mjs <ancestor> <ours> <theirs> (git merge driver %O %A %B)");
    process.exit(2);
  }
  const merged = mergeLocaleJson(readJson(ancestorPath), readJson(oursPath), readJson(theirsPath), {
    mainSide: detectMainSide(),
  });
  fs.writeFileSync(oursPath, `${JSON.stringify(merged, null, 2)}\n`);
  process.exit(0);
}
