import type { PairwiseCaseResult, PairwiseVerdictRecord } from "./types";

/**
 * Swap-consistent pairwise tallying — B2692, per the ticket's research note
 * (MT-Bench: a judge that is only ever asked once, in one order, is biased
 * toward whichever side it saw first). A win counts only when it survives
 * being asked the other way round; a case where the two orders disagree is
 * a tie, not evidence for either model.
 */

export type PairwiseVerdict = "a" | "b" | "tie";

/** One case's verdict, from both judge calls. `order1` judged (A, B); its
 *  pick maps straight across. `order2` judged (B, A); its pick maps the
 *  other way, since "first" in that call was B. */
export function pairwiseVerdict(c: Pick<PairwiseCaseResult, "order1" | "order2">): PairwiseVerdict {
  const v1: PairwiseVerdict = c.order1 === "first" ? "a" : c.order1 === "second" ? "b" : "tie";
  const v2: PairwiseVerdict = c.order2 === "first" ? "b" : c.order2 === "second" ? "a" : "tie";
  return v1 === v2 ? v1 : "tie";
}

export type PairwiseTally = {
  aWins: number;
  bWins: number;
  ties: number;
  perCase: { caseId: string; label: string; verdict: PairwiseVerdict }[];
};

/** Pairs up `pairwise-verdicts.jsonl`'s two rows per case (one `"AB"`, one
 *  `"BA"`) into the `{order1, order2}` shape `pairwiseVerdict` reads. A case
 *  missing either order is dropped with its id reported, rather than
 *  silently scored as a tie. */
export function fromVerdictRecords(
  labels: Map<string, string>,
  records: PairwiseVerdictRecord[],
): { results: PairwiseCaseResult[]; incomplete: string[] } {
  const byCase = new Map<string, { AB?: PairwiseVerdictRecord; BA?: PairwiseVerdictRecord }>();
  for (const r of records) {
    const entry = byCase.get(r.caseId) ?? {};
    entry[r.order] = r;
    byCase.set(r.caseId, entry);
  }
  const results: PairwiseCaseResult[] = [];
  const incomplete: string[] = [];
  for (const [caseId, pair] of byCase) {
    if (!pair.AB || !pair.BA) {
      incomplete.push(caseId);
      continue;
    }
    results.push({ caseId, label: labels.get(caseId) ?? caseId, order1: pair.AB.pick, order2: pair.BA.pick });
  }
  return { results, incomplete };
}

export function tallyPairwise(results: PairwiseCaseResult[]): PairwiseTally {
  const perCase = results.map((r) => ({ caseId: r.caseId, label: r.label, verdict: pairwiseVerdict(r) }));
  return {
    aWins: perCase.filter((r) => r.verdict === "a").length,
    bWins: perCase.filter((r) => r.verdict === "b").length,
    ties: perCase.filter((r) => r.verdict === "tie").length,
    perCase,
  };
}
