#!/usr/bin/env node

// Fast, explainable feedback for an edit loop. Vitest's dependency graph is
// necessary and incomplete here: several repository keepers read source files
// as data and import nothing they protect. This command runs both sets and
// falls back to the full suite when neither has evidence. It never replaces
// `npm run verify` before a merge. B1665, B2711.
//
// Static keepers are no longer a hand-kept list here. A test that reads the
// source tree as data (readdirSync/globSync/readFileSync of a source path,
// not a fixture it created itself) declares what it depends on with a
// trivially greppable header, in its own first line (or its second, right
// after a `// @vitest-environment` pragma):
//
//   // @scans components/studio/**, site/locales/*.json
//
// `test/scans-header-keeper.test.ts` is the keeper for the header itself —
// it fails, naming the file and line, when a test scans a source directory
// with no header. B2714 and later tickets that add a new source-scanning
// keeper test read that failure message to know what to add.
//
// A small residual list stays hand-kept below it: a coupling a *test* can't
// declare because the file doing the reading is the production code under
// test, not the test itself (it reads a sibling source file at runtime,
// outside the static import graph `vitest related` already follows).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");

// Not expressible as a `@scans` header: each test here only *imports* the
// module that, at runtime, reads the named file off disk — a coupling the
// dependency graph cannot see because the read is not a static import.
const EXTRA_KEEPERS = [
  {
    name: "brand and colour tokens (lib/brand.ts reads app/globals.css)",
    matches: (file) => file === "app/globals.css" || file === "lib/brand.ts",
    tests: ["test/brand.test.ts"],
  },
  {
    name: "capability boundaries (lib/capabilities.ts, site/config.json shape)",
    matches: (file) => file === "lib/capabilities.ts" || file === "site/config.json",
    tests: ["paid/test/capabilities.test.ts", "paid/test/server-only-capabilities.test.ts"],
  },
];

function die(message) {
  console.error(message);
  process.exit(1);
}

function gitLines(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.split("\n").filter(Boolean) : [];
}

function changedPaths() {
  const branch = gitLines(["rev-parse", "--abbrev-ref", "HEAD"])[0];
  const branchBase = branch && branch !== "main" ? gitLines(["diff", "--name-only", "--diff-filter=ACMR", "main...HEAD"]) : [];
  return [
    ...branchBase,
    ...gitLines(["diff", "--name-only", "--diff-filter=ACMR"]),
    ...gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ];
}

function normalise(file) {
  const absolute = path.resolve(ROOT, file);
  const relative = path.relative(ROOT, absolute).split(path.sep).join("/");
  if (relative === ".." || relative.startsWith("../")) die(`Path is outside the repository: ${file}`);
  return relative;
}

/** A small, deliberately dumb glob: `*` is one path segment, `**` is any
 * number of them (including zero), everything else — including `[` and `]`,
 * which Next.js route folders use literally — is matched as itself. */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if ("\\^$+?.()|{}[]".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function findTestFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, "test"));
  walk(path.join(ROOT, "paid", "test"));
  return out;
}

/** Reads a test file's `// @scans <globs>` header, from its first line or
 * its second (right after a `// @vitest-environment` pragma, which vitest
 * requires to stay first). Returns null when the file has none. */
function scansHeader(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n", 3);
  for (const line of lines.slice(0, 2)) {
    const m = /^\/\/\s*@scans\s+(.+)$/.exec(line.trim());
    if (m) return m[1].split(",").map((g) => g.trim()).filter(Boolean);
  }
  return null;
}

function deriveKeepers() {
  return findTestFiles()
    .map((file) => {
      const globs = scansHeader(file);
      if (!globs) return null;
      const regexes = globs.map(globToRegExp);
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      return {
        name: `@scans header: ${rel}`,
        matches: (changed) => regexes.some((re) => re.test(changed)),
        tests: [rel],
      };
    })
    .filter(Boolean);
}

function runVitest(args) {
  const result = spawnSync(process.execPath, [VITEST, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  return result;
}

const argv = process.argv.slice(2);
const planOnly = argv.includes("--plan");
const explicit = argv.filter((arg) => arg !== "--plan");
const files = [...new Set((explicit.length > 0 ? explicit : changedPaths()).map(normalise))].sort();

if (files.length === 0) {
  die("No changed paths found. Pass one or more paths, or run from a branch with changes from main.");
}

console.log(`Changed paths (${files.length}):`);
for (const file of files) console.log(`  ${file}`);

const KEEPERS = [...deriveKeepers(), ...EXTRA_KEEPERS];
const selected = KEEPERS.filter((keeper) => files.some(keeper.matches));
const keeperTests = [...new Set(selected.flatMap((keeper) => keeper.tests))].sort();

console.log("\nDependency checks:");
console.log("  Vitest related tests for every changed path.");
console.log("\nStatic keepers:");
if (selected.length === 0) console.log("  none mapped");
for (const keeper of selected) {
  console.log(`  ${keeper.name}: ${keeper.tests.join(", ")}`);
}

if (planOnly) {
  console.log(
    selected.length === 0
      ? "\nFallback: run the full Vitest suite if the dependency graph also finds nothing."
      : "\nFallback: static keepers cover paths the dependency graph cannot see.",
  );
  process.exit(0);
}

if (!fs.existsSync(VITEST)) die("node_modules is missing Vitest. Bootstrap this worktree first.");

let exitCode = 0;

console.log("\nRunning dependency-related tests...");
const related = runVitest(["related", ...files, "--run", "--reporter=dot"]);
const noRelatedTests = /No test files found|No test suite found/i.test(
  `${related.stdout}\n${related.stderr}`,
);
if (related.status !== 0 && !noRelatedTests) exitCode = related.status ?? 1;

let ranAnyTests = !noRelatedTests;
if (exitCode === 0 && keeperTests.length > 0) {
  console.log("\nRunning static keepers...");
  const keepers = runVitest(["run", ...keeperTests, "--reporter=dot"]);
  ranAnyTests = true;
  if (keepers.status !== 0) exitCode = keepers.status ?? 1;
} else if (exitCode === 0 && noRelatedTests) {
  console.log("\nNo dependency or static mapping found; running the full Vitest suite.");
  const fallback = runVitest(["run", "--reporter=dot"]);
  ranAnyTests = true;
  if (fallback.status !== 0) exitCode = fallback.status ?? 1;
}

let knipStatus = "ok";
if (exitCode === 0) {
  console.log("\nRunning npm run unused (knip)...");
  const knip = spawnSync("npm", ["run", "unused"], { cwd: ROOT, encoding: "utf8", stdio: "inherit" });
  if (knip.status !== 0) {
    knipStatus = "fail";
    exitCode = knip.status ?? 1;
  }
} else {
  knipStatus = "skipped";
}

console.log(`\ncheck:changed exit=${exitCode} files=${files.length} tests=${ranAnyTests ? keeperTests.length : 0} knip=${knipStatus}`);
console.log("Run `npm run verify` before merging.");
process.exit(exitCode);
