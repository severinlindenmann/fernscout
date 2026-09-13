#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contextForPaths } from "./agent-index.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const detailed = args.includes("--detailed");
const json = args.includes("--json");
const taskId = args.find((arg) => /^B\d+$/.test(arg));

function die(message) {
  console.error(message);
  process.exit(1);
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function repositoryPaths(text) {
  const found = text.match(/(?:\.claude|app|components|docs|lib|public|scripts|site|test)\/[A-Za-z0-9_@.()[\]{}+-]+(?:\/[A-Za-z0-9_@.()[\]{}+-]+)*/g) ?? [];
  return found.map((file) => file.replace(/[`,:;.]+$/, "")).filter((file) => fs.existsSync(path.join(root, file)));
}

if (!taskId) die("Usage: npm run agent:context -- B1665 [--detailed|--json]");

const taskFile = walk(path.join(root, "docs", "tasks")).find((file) => path.basename(file).startsWith(`${taskId}-`));
if (!taskFile) die(`Task ${taskId} was not found.`);
const taskText = fs.readFileSync(taskFile, "utf8");
const title = taskText.match(/^title:\s*(.+)$/m)?.[1] ?? taskText.match(/^#\s+[^—]+—\s+(.+)$/m)?.[1] ?? taskId;

const history = spawnSync("git", ["log", "--all", "--format=", "--name-only", `--grep=${taskId}`], {
  cwd: root,
  encoding: "utf8",
});
const historyPaths = (history.stdout ?? "").split("\n").filter((file) => file && fs.existsSync(path.join(root, file)));
const paths = [...new Set([...repositoryPaths(taskText), ...historyPaths])]
  .filter((file) => !file.startsWith("docs/tasks/") && file !== "docs/tasks/INDEX.md")
  .sort();
const areas = contextForPaths(paths);
const result = {
  task: taskId,
  title,
  taskFile: path.relative(root, taskFile).split(path.sep).join("/"),
  paths,
  areas: areas.map((area) => area.name),
  tests: [...new Set(areas.flatMap((area) => area.tests))].sort(),
  docs: [...new Set(areas.flatMap((area) => area.docs))].sort(),
  skills: [...new Set(areas.flatMap((area) => area.skills))].sort(),
  visibleChecks: [...new Set(areas.flatMap((area) => area.visible))],
};

if (json) {
  console.log(JSON.stringify(result));
  process.exit(0);
}

console.log(`${result.task} — ${result.title}`);
console.log(`Task: ${result.taskFile}`);
const shownPaths = detailed ? paths : paths.slice(0, 12);
console.log(`\nRelevant paths (${paths.length}${detailed || paths.length <= 12 ? "" : ", first 12 shown"}):`);
for (const file of shownPaths) console.log(`  ${file}`);
for (const [label, values] of [
  ["Tests", result.tests],
  ["Docs", result.docs],
  ["Skills", result.skills],
  ["Visible checks", result.visibleChecks],
]) {
  console.log(`\n${label}:`);
  if (values.length === 0) console.log("  none mapped — inspect the task and broaden verification");
  for (const value of values) console.log(`  ${value}`);
}
if (!detailed && paths.length > 12) console.log("\nUse --detailed for every discovered path; --json is machine-readable.");
