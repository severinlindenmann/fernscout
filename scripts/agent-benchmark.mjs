#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const corpusFile = path.join(root, "docs", "benchmarks", "agent-efficiency", "corpus.json");
const corpus = JSON.parse(fs.readFileSync(corpusFile, "utf8"));
const args = process.argv.slice(2);
const scoreAt = args.indexOf("--score");
const outAt = args.indexOf("--out");

function die(message) {
  console.error(message);
  process.exit(1);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function writeResult(result) {
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (outAt !== -1) {
    const requested = args[outAt + 1];
    if (!requested) die("--out needs a repository-relative JSON path.");
    const file = path.resolve(root, requested);
    const relative = path.relative(root, file);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) die("--out must stay inside the repository.");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, output);
    console.log(`Wrote aggregate benchmark data to ${relative}.`);
  } else {
    process.stdout.write(output);
  }
}

function scoreRuns(file) {
  const input = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
  if (!Array.isArray(input.runs) || input.runs.length === 0) die("--score input needs a non-empty runs array.");
  const allowed = new Set([
    "caseId", "variant", "instructionBytes", "toolCalls", "toolOutputBytes", "timeToFirstEditMs",
    "focusedTestMs", "fullGateMs", "retries", "finalFailures", "selectedChecks", "acceptanceMet",
    "unrelatedDiff", "weakenedAssertion", "forbiddenActions",
  ]);
  const numeric = ["instructionBytes", "toolCalls", "toolOutputBytes", "timeToFirstEditMs", "focusedTestMs", "fullGateMs", "retries", "finalFailures", "forbiddenActions"];
  for (const run of input.runs) {
    const unknown = Object.keys(run).filter((key) => !allowed.has(key));
    if (unknown.length) die(`Run ${run.caseId ?? "?"} contains forbidden/raw fields: ${unknown.join(", ")}.`);
    if (!run.caseId || !run.variant) die("Every run needs caseId and variant.");
    for (const key of numeric) if (!Number.isFinite(run[key]) || run[key] < 0) die(`${run.caseId}.${key} must be a non-negative number.`);
    for (const key of ["acceptanceMet", "unrelatedDiff", "weakenedAssertion"]) if (typeof run[key] !== "boolean") die(`${run.caseId}.${key} must be boolean.`);
    if (!Array.isArray(run.selectedChecks)) die(`${run.caseId}.selectedChecks must be an array.`);
  }

  const variants = Object.groupBy(input.runs, (run) => run.variant);
  const caseById = new Map(corpus.cases.map((item) => [item.id, item]));
  return {
    schemaVersion: 1,
    sourceRuns: input.runs.length,
    variants: Object.fromEntries(Object.entries(variants).map(([name, runs]) => [name, {
      runs: runs.length,
      selectionPasses: runs.filter((run) => {
        const expected = caseById.get(run.caseId)?.requiredChecks ?? [];
        return expected.every((check) => run.selectedChecks.includes(check));
      }).length,
      correctnessPasses: runs.filter((run) => {
        const expected = caseById.get(run.caseId)?.requiredChecks ?? [];
        return run.acceptanceMet && !run.unrelatedDiff && !run.weakenedAssertion &&
          run.forbiddenActions === 0 && run.finalFailures === 0 &&
          expected.every((check) => run.selectedChecks.includes(check));
      }).length,
      medianInstructionBytes: median(runs.map((run) => run.instructionBytes)),
      medianToolCalls: median(runs.map((run) => run.toolCalls)),
      medianToolOutputBytes: median(runs.map((run) => run.toolOutputBytes)),
      medianTimeToFirstEditMs: median(runs.map((run) => run.timeToFirstEditMs)),
      medianFocusedTestMs: median(runs.map((run) => run.focusedTestMs)),
      medianFullGateMs: median(runs.map((run) => run.fullGateMs)),
      medianRetries: median(runs.map((run) => run.retries)),
    }])),
  };
}

if (scoreAt !== -1) {
  const file = args[scoreAt + 1];
  if (!file) die("--score needs a structured run-metrics JSON file.");
  writeResult(scoreRuns(file));
  process.exit(0);
}

let required = 0;
let found = 0;
const cases = [];
for (const item of corpus.cases) {
  const started = performance.now();
  const plan = spawnSync(process.execPath, [path.join(root, "scripts", "check-changed.mjs"), "--plan", ...item.paths], { cwd: root, encoding: "utf8" });
  if (plan.status !== 0) die(plan.stderr || `Changed-check planning failed for ${item.id}.`);
  const context = spawnSync(process.execPath, [path.join(root, "scripts", "agent-context.mjs"), item.id, "--json"], { cwd: root, encoding: "utf8" });
  if (context.status !== 0) die(context.stderr || `Context lookup failed for ${item.id}.`);
  const missing = item.requiredChecks.filter((check) => !plan.stdout.includes(check));
  required += item.requiredChecks.length;
  found += item.requiredChecks.length - missing.length;
  cases.push({
    id: item.id,
    kind: item.kind,
    knownFailureCase: Boolean(item.failureCase),
    selectedAllRequiredChecks: missing.length === 0,
    missingChecks: missing,
    contextBytes: Buffer.byteLength(context.stdout),
    checkPlanBytes: Buffer.byteLength(plan.stdout),
    discoveryMs: Math.round(performance.now() - started),
  });
}

writeResult({
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  corpusCases: cases.length,
  knownFailureCases: cases.filter((item) => item.knownFailureCase).length,
  rootInstructionBytes: fs.statSync(path.join(root, "AGENTS.md")).size,
  selectionRecall: required === 0 ? null : found / required,
  requiredChecks: required,
  selectedRequiredChecks: found,
  medianContextBytes: median(cases.map((item) => item.contextBytes)),
  medianCheckPlanBytes: median(cases.map((item) => item.checkPlanBytes)),
  medianDiscoveryMs: median(cases.map((item) => item.discoveryMs)),
  cases,
});
