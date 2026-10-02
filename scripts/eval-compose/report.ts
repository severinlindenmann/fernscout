import { fromVerdictRecords, tallyPairwise } from "./pairwise";
import type { CaseDump, PairwiseDump, PairwiseVerdictRecord, VerdictRecord } from "./types";

/**
 * Turns `cases.jsonl` (+ `verdicts.jsonl`, when judging has happened — by
 * `EVAL_JUDGE=api` or by a person/subagent following `judge-instructions.md`)
 * into one markdown file a person reads in a minute — B2692's acceptance "a
 * runnable script reports pass rates per check". No model call, no
 * filesystem read: `report.mts` does both and hands this file plain data.
 */

const GUARD_BUCKETS: { pattern: RegExp; label: string }[] = [
  { pattern: /cites unknown/, label: "unknown source id" },
  { pattern: /clock time .* not in a cited note/, label: "clock time not in notes" },
  { pattern: /number .* (not in its sources|from a voice sample)/, label: "ungrounded number" },
  { pattern: /unit .* not in its sources/, label: "ungrounded unit" },
  { pattern: /does not match/, label: "calendar mismatch" },
  { pattern: /only in a voice sample/, label: "voice-sample leak" },
  { pattern: /not in its sources/, label: "ungrounded detail" },
  { pattern: /uncited, and/, label: "uncited content word" },
  { pattern: /banned "/, label: "banned phrase" },
  { pattern: /travels alone/, label: "unwarranted \"we\"" },
  { pattern: /words, at most/, label: "too long" },
  { pattern: /title .* not grounded/, label: "title not grounded" },
  { pattern: /quote title .* not in the notes/, label: "title not a real quote" },
  { pattern: /^(close|story): empty$/, label: "empty variant" },
  { pattern: /notes under \d+ words/, label: "story too thin" },
];

export function classifyDropReason(reason: string): string {
  for (const { pattern, label } of GUARD_BUCKETS) if (pattern.test(reason)) return label;
  return "other";
}

function pct(pass: number, total: number): string {
  return total === 0 ? "n/a" : `${Math.round((pass / total) * 100)}%`;
}

function tally<T>(items: T[], keyOf: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) {
    const k = keyOf(item);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function verdictKey(caseId: string, variant: string): string {
  return `${caseId}::${variant}`;
}

type Scored = { dump: CaseDump; verdicts: VerdictRecord[]; failures: number };

function scoreCases(cases: CaseDump[], verdictsByKey: Map<string, VerdictRecord>): Scored[] {
  return cases.map((dump) => {
    const verdicts = dump.variants
      .map((v) => verdictsByKey.get(verdictKey(dump.caseId, v.slot)))
      .filter((v): v is VerdictRecord => v !== undefined);
    const judgeFailures = verdicts.filter(
      (v) => !v.grounding.pass || v.endsWithSummingUp || !v.wouldPublish.pass,
    ).length;
    return { dump, verdicts, failures: dump.dropped.length + judgeFailures + (dump.ok ? 0 : 1) };
  });
}

export type ReportInput = {
  cases: CaseDump[];
  verdicts: VerdictRecord[];
  pairwise?: { dumps: PairwiseDump[]; verdicts: PairwiseVerdictRecord[] };
};

export function buildReport(input: ReportInput): string {
  const lines: string[] = ["# Compose eval report", ""];
  const total = input.cases.length;
  const ok = input.cases.filter((c) => c.ok).length;
  lines.push(`${total} cases, ${ok} composed, ${total - ok} rejected (both variants failed their guards or the call errored).`, "");

  // --- judge pass rates, overall and per model ---
  const verdictsByKey = new Map(input.verdicts.map((v) => [verdictKey(v.caseId, v.variant), v]));
  const judgedVariants = input.cases.flatMap((c) => c.variants.map((v) => ({ model: c.model, verdict: verdictsByKey.get(verdictKey(c.caseId, v.slot)) })));
  const judged = judgedVariants.filter((v): v is { model: string; verdict: VerdictRecord } => v.verdict !== undefined);

  lines.push("## Judge pass rates");
  if (judged.length === 0) {
    lines.push("", "No `verdicts.jsonl` yet — run the judges (by hand, by subagent, or `EVAL_JUDGE=api`) and re-run the report.", "");
  } else {
    lines.push(
      "",
      "| model | n | grounded | no summing-up ending | would publish |",
      "| --- | --- | --- | --- | --- |",
    );
    const models = [...new Set(judged.map((j) => j.model))];
    for (const model of ["(all)", ...models]) {
      const rows = model === "(all)" ? judged : judged.filter((j) => j.model === model);
      const n = rows.length;
      const grounded = rows.filter((r) => r.verdict.grounding.pass).length;
      const noSummingUp = rows.filter((r) => !r.verdict.endsWithSummingUp).length;
      const wouldPublish = rows.filter((r) => r.verdict.wouldPublish.pass).length;
      lines.push(`| ${model} | ${n} | ${pct(grounded, n)} | ${pct(noSummingUp, n)} | ${pct(wouldPublish, n)} |`);
    }
    lines.push("");
  }

  // --- deterministic banned-phrase rate, no judge needed ---
  const variants = input.cases.flatMap((c) => c.variants);
  const bannedCount = variants.filter((v) => v.bannedPhraseHits.length > 0).length;
  lines.push("## Banned-phrase check (code, not a judge)", "", `${bannedCount} of ${variants.length} variants used a banned phrase the owner did not write.`, "");

  // --- drop rates per guard reason ---
  const reasons = input.cases.flatMap((c) => c.dropped.map(classifyDropReason));
  const buckets = tally(reasons, (r) => r);
  lines.push("## Guard drops, by reason", "");
  if (buckets.size === 0) {
    lines.push("Nothing dropped.", "");
  } else {
    lines.push("| reason | count |", "| --- | --- |");
    for (const [reason, count] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${reason} | ${count} |`);
    lines.push("");
  }

  // --- cost per day ---
  const priced = input.cases.filter((c) => c.costUsd !== null);
  lines.push("## Cost", "");
  if (priced.length === 0) {
    lines.push("No database was configured, so no usage row could be read back — cost unknown.", "");
  } else {
    const totalUsd = priced.reduce((s, c) => s + (c.costUsd ?? 0), 0);
    lines.push(`${priced.length} of ${total} cases priced from the usage ledger — $${totalUsd.toFixed(4)} total, $${(totalUsd / priced.length).toFixed(4)} per day.`, "");
  }

  // --- worst cases ---
  const scored = scoreCases(input.cases, verdictsByKey)
    .filter((s) => s.failures > 0)
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 5);
  lines.push("## Worst cases", "");
  if (scored.length === 0) {
    lines.push("Nothing failed a guard or a judge.", "");
  } else {
    for (const s of scored) {
      lines.push(`### ${s.dump.label} (${s.dump.caseId}, ${s.dump.model})`, "");
      lines.push(`Notes: ${s.dump.notes.join(" / ") || "(none)"}`, "");
      if (!s.dump.ok) lines.push(`Rejected: ${s.dump.error ?? "unknown error"}`, "");
      for (const v of s.dump.variants) lines.push(`${v.slot}: ${v.text || "(empty)"}`, "");
      if (s.dump.dropped.length > 0) lines.push(`Dropped: ${s.dump.dropped.join("; ")}`, "");
      const badVerdicts = s.verdicts.filter((v) => !v.grounding.pass || v.endsWithSummingUp || !v.wouldPublish.pass);
      for (const v of badVerdicts) {
        const notes: string[] = [];
        if (!v.grounding.pass) notes.push(`unsupported: ${v.grounding.claims.filter((c) => c.sourceId === "UNSUPPORTED").map((c) => c.text).join("; ")}`);
        if (v.endsWithSummingUp) notes.push("ends with a summing-up line");
        if (!v.wouldPublish.pass) notes.push(`would not publish: ${v.wouldPublish.critique}`);
        lines.push(`Judge (${v.variant}): ${notes.join(" / ")}`, "");
      }
    }
  }

  // --- pairwise ---
  if (input.pairwise) {
    const labels = new Map(input.pairwise.dumps.map((d) => [d.caseId, d.label]));
    const { results, incomplete } = fromVerdictRecords(labels, input.pairwise.verdicts);
    const t = tallyPairwise(results);
    const { modelA, modelB } = input.pairwise.dumps[0] ?? { modelA: "A", modelB: "B" };
    lines.push("## Pairwise", "", `${modelA} vs ${modelB}, judged in both orders — a win only counts if it survives the swap.`, "");
    lines.push(`${modelA}: ${t.aWins} · ${modelB}: ${t.bWins} · tie: ${t.ties}`, "");
    if (incomplete.length > 0) lines.push(`Missing one order for: ${incomplete.join(", ")} — not tallied.`, "");
    lines.push("");
  }

  return lines.join("\n");
}
