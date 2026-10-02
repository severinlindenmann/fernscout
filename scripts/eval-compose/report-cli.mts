/**
 * Merges a judged run into `report.md` — B2692, the no-model-call half.
 *
 *   npm run eval:compose:report -- --from /tmp/claude-501/eval-compose/<timestamp>
 *
 * Reads `cases.jsonl` + `verdicts.jsonl` (written by `run.mts`, and by
 * whoever judged them — a person, a subagent, or `EVAL_JUDGE=api`) from the
 * given directory, plus `pairwise.jsonl` + `pairwise-verdicts.jsonl` when
 * they exist, and writes `report.md` beside them. Calls no model and reads
 * nothing outside the directory it is given — this is the step a person
 * runs after a subagent round of judging has written `verdicts.jsonl` by
 * hand.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildReport } from "./report";
import type { CaseDump, PairwiseDump, PairwiseVerdictRecord, VerdictRecord } from "./types";

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

const fromIndex = process.argv.indexOf("--from");
const dir = fromIndex >= 0 ? process.argv[fromIndex + 1] : process.env.EVAL_REPORT_FROM;
if (!dir) {
  console.error("Usage: npm run eval:compose:report -- --from <dir>  (or EVAL_REPORT_FROM=<dir>)");
  process.exit(1);
}

const cases = readJsonl<CaseDump>(path.join(dir, "cases.jsonl"));
const verdicts = readJsonl<VerdictRecord>(path.join(dir, "verdicts.jsonl"));
const pairwiseDumps = readJsonl<PairwiseDump>(path.join(dir, "pairwise.jsonl"));
const pairwiseVerdicts = readJsonl<PairwiseVerdictRecord>(path.join(dir, "pairwise-verdicts.jsonl"));

if (cases.length === 0) {
  console.error(`No cases.jsonl (or it is empty) in ${dir}`);
  process.exit(1);
}

const report = buildReport({
  cases,
  verdicts,
  pairwise: pairwiseDumps.length > 0 ? { dumps: pairwiseDumps, verdicts: pairwiseVerdicts } : undefined,
});
const outFile = path.join(dir, "report.md");
fs.writeFileSync(outFile, report);
console.log(`${cases.length} cases, ${verdicts.length} verdicts${pairwiseVerdicts.length > 0 ? `, ${pairwiseVerdicts.length} pairwise verdicts` : ""} → ${outFile}`);
