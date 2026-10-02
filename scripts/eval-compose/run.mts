/**
 * The compose eval harness — B2692.
 *
 *   npm run eval:compose                           # dry run: shows the picked cases, no model call
 *   EVAL_CONFIRM=1 npm run eval:compose             # spends real money on the composer only
 *   EVAL_CONTENT_DIR=/path/to/owner/content EVAL_USER=severin EVAL_CONFIRM=1 npm run eval:compose
 *   EVAL_PAIR=claude-haiku-4-5,claude-sonnet-5 EVAL_CONFIRM=1 npm run eval:compose
 *
 * then (after judging `cases.jsonl` — see `judge-instructions.md` in the
 * output directory — by hand, by subagent, or with `EVAL_JUDGE=api`):
 *
 *   npm run eval:compose:report -- --from /tmp/.../eval-compose/<timestamp>
 *
 * Judging is never automatic: the default writes `cases.jsonl` and
 * `judge-instructions.md` and stops, because API credit is scarce and a
 * person or a subagent reading the dump costs nothing. `EVAL_JUDGE=api`
 * spends more credit to judge with a model too (`EVAL_JUDGE_MODEL`,
 * default `modelFor("small")`) and writes `report.md` itself.
 *
 * `EVAL_CONFIRM=1` gates the only thing here that calls a real model: the
 * composer. Without it this prints the cost plan and the selected cases
 * and exits — the harness's own "dry run". See `README.md` beside this
 * file for the full list of env vars.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { renderDayPack, type DayPack } from "../../lib/helper/dayContext";
import { modelFor } from "../../lib/helper/models";
import { buildGoldenCases } from "./build-golden";
import { estimateCost } from "./cost";
import { judgeRubricMarkdown, judgeVariant } from "./judges";
import { buildReport } from "./report";
import { runAll, runPairwise } from "./runner";
import type { CaseDump, EvalCase, VerdictRecord } from "./types";

// `contentRoot()` re-reads the environment on every call (see its own
// header comment), so this only needs to land before the first call that
// reads a trip — which is still "before anything below", for clarity.
if (process.env.EVAL_CONTENT_DIR) process.env.CONTENT_DIR = process.env.EVAL_CONTENT_DIR;

const EVAL_USER = process.env.EVAL_USER?.trim() || "example";
const EVAL_DAYS = Number(process.env.EVAL_DAYS) || 20;
const EVAL_JUDGE = process.env.EVAL_JUDGE?.trim() || "off";
const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL?.trim() || modelFor("small");
const EVAL_PAIR = process.env.EVAL_PAIR?.trim();
const [pairModelA, pairModelB] = EVAL_PAIR ? EVAL_PAIR.split(",").map((s) => s.trim()) : [undefined, undefined];
const EVAL_MODEL = process.env.EVAL_MODEL?.trim() || modelFor("compose");
const EVAL_CONFIRM = process.env.EVAL_CONFIRM === "1";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const EVAL_OUT = process.env.EVAL_OUT?.trim() || `/tmp/claude-501/eval-compose/${timestamp}`;

if (EVAL_PAIR && (!pairModelA || !pairModelB)) {
  console.error(`EVAL_PAIR must be "modelA,modelB", got: ${EVAL_PAIR}`);
  process.exit(1);
}

type HardCaseFixture = { id: string; label: string; pack: DayPack };
const hardCasesPath = path.join(import.meta.dirname, "hard-cases.json");
const hardFixtures = JSON.parse(fs.readFileSync(hardCasesPath, "utf8")) as HardCaseFixture[];
const hardCases: EvalCase[] = hardFixtures.map((h) => ({ id: h.id, source: "hard", label: h.label, pack: h.pack }));

const goldenCases = buildGoldenCases(EVAL_USER, EVAL_DAYS);
const cases: EvalCase[] = [...goldenCases, ...hardCases];

console.log(`Selected ${cases.length} cases (${goldenCases.length} golden from "${EVAL_USER}", ${hardCases.length} hard/synthetic):`);
for (const c of cases) console.log(`  ${c.id}  —  ${c.label}`);

const plan = estimateCost({
  cases: cases.length,
  pairwise: Boolean(EVAL_PAIR),
  judgesEnabled: EVAL_JUDGE === "api",
  composeModel: EVAL_PAIR && pairModelA ? pairModelA : EVAL_MODEL,
  judgeModel: EVAL_JUDGE_MODEL,
});
console.log(
  `\nPlanned calls: ${plan.composeCalls} composer${plan.judgeCalls > 0 ? ` + ${plan.judgeCalls} judge (EVAL_JUDGE=api)` : ""}` +
    ` = ${plan.totalCalls} total. Rough estimate: $${plan.estimatedUsd.toFixed(2)}.`,
);

if (!EVAL_CONFIRM) {
  console.log(
    "\nDry run only — no model was called. Set EVAL_CONFIRM=1 to actually run the composer " +
      "(and, with EVAL_JUDGE=api, the judges) against the plan above.",
  );
  process.exit(0);
}

fs.mkdirSync(EVAL_OUT, { recursive: true });

function writeJsonl(file: string, rows: unknown[]): void {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : ""));
}

let caseDumpsForReport: CaseDump[];

if (EVAL_PAIR && pairModelA && pairModelB) {
  const pairwiseDumps = await runPairwise(cases, pairModelA, pairModelB);
  const flattened = pairwiseDumps.flatMap((d) => [
    { ...d.outputA, caseId: `${d.caseId}::A` },
    { ...d.outputB, caseId: `${d.caseId}::B` },
  ]);
  caseDumpsForReport = flattened;
  writeJsonl(path.join(EVAL_OUT, "cases.jsonl"), flattened);
  writeJsonl(path.join(EVAL_OUT, "pairwise.jsonl"), pairwiseDumps);
  console.log(`\nWrote ${flattened.length} case dumps (${pairModelA} vs ${pairModelB}) to ${EVAL_OUT}/cases.jsonl and pairwise.jsonl`);
} else {
  caseDumpsForReport = await runAll(cases, EVAL_MODEL);
  writeJsonl(path.join(EVAL_OUT, "cases.jsonl"), caseDumpsForReport);
  console.log(`\nWrote ${caseDumpsForReport.length} case dumps to ${EVAL_OUT}/cases.jsonl`);
}

fs.writeFileSync(path.join(EVAL_OUT, "judge-instructions.md"), judgeRubricMarkdown());
console.log(`Wrote judge instructions to ${EVAL_OUT}/judge-instructions.md`);

if (EVAL_JUDGE === "api") {
  console.log(`\nJudging with ${EVAL_JUDGE_MODEL} (EVAL_JUDGE=api) — this is extra API spend.`);
  const verdicts: VerdictRecord[] = [];
  for (const dump of caseDumpsForReport) {
    for (const variant of dump.variants) {
      const packXml = renderDayPack(dump.pack as DayPack);
      verdicts.push(
        await judgeVariant({ caseId: dump.caseId, variant: variant.slot, notes: dump.notes, packXml, text: variant.text, model: EVAL_JUDGE_MODEL }),
      );
    }
  }
  writeJsonl(path.join(EVAL_OUT, "verdicts.jsonl"), verdicts);
  const report = buildReport({ cases: caseDumpsForReport, verdicts });
  fs.writeFileSync(path.join(EVAL_OUT, "report.md"), report);
  console.log(`Wrote ${verdicts.length} verdicts and the report to ${EVAL_OUT}`);
} else {
  console.log(
    `\nEVAL_JUDGE=off (default) — no judge model was called. Judge ${path.join(EVAL_OUT, "cases.jsonl")} ` +
      `per ${path.join(EVAL_OUT, "judge-instructions.md")}, write ${path.join(EVAL_OUT, "verdicts.jsonl")}` +
      (EVAL_PAIR ? ` and ${path.join(EVAL_OUT, "pairwise-verdicts.jsonl")}` : "") +
      `, then:\n  npm run eval:compose:report -- --from ${EVAL_OUT}`,
  );
}
