#!/usr/bin/env node

// Fast, explainable feedback for an edit loop. Vitest's dependency graph is
// necessary and incomplete here: several repository keepers read source files
// as data and import nothing they protect. This command runs both sets and
// falls back to the full suite when neither has evidence. It never replaces
// `npm run verify` before a merge. B1665.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");

const KEEPERS = [
  {
    name: "skill documents",
    matches: (file) => file.startsWith(".claude/skills/") || file.startsWith(".agents/skills/"),
    tests: ["test/skill-docs.test.ts"],
  },
  {
    name: "localisation keys and maintained locales",
    matches: (file) => file.startsWith("site/locales/") || file === "lib/i18n.ts",
    tests: ["test/locales.test.ts", "test/skill-docs.test.ts"],
  },
  {
    name: "API route and OpenAPI contracts",
    matches: (file) => file.startsWith("app/api/") || file.startsWith("lib/api/"),
    tests: [
      "test/api-route-schemas.test.ts",
      "test/openapi-contract.test.ts",
      "test/openapi-v2-contract.test.ts",
      "test/openapi-v2-required-or-declined.test.ts",
    ],
  },
  {
    name: "where up is, and that nothing navigates by history",
    matches: (file) =>
      file === "lib/navUp.ts" || file.startsWith("app/") || file.startsWith("components/"),
    tests: ["test/nav-up.test.ts", "test/back-to-journals.test.tsx"],
  },
  {
    name: "brand and colour source scans",
    matches: (file) =>
      file === "lib/theme.ts" ||
      file.startsWith("app/") ||
      file.startsWith("components/") ||
      /\.(?:css|svg)$/.test(file),
    tests: ["test/brand.test.ts", "test/undefined-color-tokens.test.ts"],
  },
  {
    name: "browser-dialog source scan",
    matches: (file) => file.startsWith("app/") || file.startsWith("components/"),
    tests: ["test/no-browser-dialogs.test.ts"],
  },
  {
    name: "depersonalised source scan",
    matches: (file) => /^(?:app|components|lib|public|scripts)\//.test(file),
    tests: ["test/depersonalised.test.ts"],
  },
  {
    name: "capability boundaries",
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

console.log("\nRunning dependency-related tests...");
const related = runVitest(["related", ...files, "--run", "--reporter=dot"]);
const noRelatedTests = /No test files found|No test suite found/i.test(
  `${related.stdout}\n${related.stderr}`,
);
if (related.status !== 0 && !noRelatedTests) process.exit(related.status ?? 1);

if (keeperTests.length > 0) {
  console.log("\nRunning static keepers...");
  const keepers = runVitest(["run", ...keeperTests, "--reporter=dot"]);
  if (keepers.status !== 0) process.exit(keepers.status ?? 1);
} else if (noRelatedTests) {
  console.log("\nNo dependency or static mapping found; running the full Vitest suite.");
  const fallback = runVitest(["run", "--reporter=dot"]);
  if (fallback.status !== 0) process.exit(fallback.status ?? 1);
}

console.log("\nChanged-path checks passed. Run `npm run verify` before merging.");
