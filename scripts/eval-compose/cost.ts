/**
 * The pre-flight cost estimate — B2692's acceptance "ask the owner before
 * each run". Pure arithmetic over counts, so it can be shown and tested
 * without touching the network, and run before `EVAL_CONFIRM` is even
 * checked.
 *
 * ponytail: published list-price USD/MTok, no cache discount modelled (the
 * real system prompt *is* cached in production, so an actual run will cost
 * less than this says) and a flat guess at tokens per call. This is a
 * guardrail against "oops, 40 dollars", not an invoice — the real figure
 * per case comes back from the usage ledger after the run (`runner.ts`),
 * priced by `callCostRappen` (lib/usage.ts), which is the number this file
 * is deliberately *not* trying to replace.
 *
 * Judging is a model call (`judgeCalls`) only when `EVAL_JUDGE=api` is set
 * — the default is to dump `cases.jsonl` for a person or subagent to judge
 * for free, so `judgesEnabled: false` (the CLI's default) prices only the
 * composer calls this script will actually make. A pairwise comparison
 * (A vs B, both orders) is *never* a call this script makes — per the
 * owner's own decision while credit was scarce, it is always judged
 * externally — so it has no line here at all; this prices only what
 * `run.mts` can actually spend.
 */

const FALLBACK_PRICE_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const DEFAULT_PRICE = { input: 3, output: 15 };

/** Rough tokens for one call of each shape — a day pack plus the frozen
 *  system prompt in, a structured compose answer out; a pack plus one
 *  variant's text in, a short yes/no-and-a-line out for a judge. */
const ROUGH_TOKENS = {
  compose: { input: 3000, output: 700 },
  judge: { input: 2000, output: 150 },
};

function priceFor(model: string): { input: number; output: number } {
  return FALLBACK_PRICE_USD_PER_MTOK[model] ?? DEFAULT_PRICE;
}

function callUsd(model: string, shape: keyof typeof ROUGH_TOKENS): number {
  const price = priceFor(model);
  const tokens = ROUGH_TOKENS[shape];
  return (tokens.input * price.input + tokens.output * price.output) / 1_000_000;
}

export type CostPlan = {
  composeCalls: number;
  judgeCalls: number;
  totalCalls: number;
  estimatedUsd: number;
};

export type CostPlanOpts = {
  cases: number;
  /** A second model run over the same cases, compared pairwise. */
  pairwise: boolean;
  /** The three judges (grounding, banned/summing-up, would-publish) run. */
  judgesEnabled: boolean;
  composeModel: string;
  judgeModel: string;
  /** Conservative average variants surviving per case (close, and story
   *  when the notes are not thin) — judges run once per surviving variant. */
  variantsPerCase?: number;
};

const RETRY_FACTOR = 1.15; // composeDay's one banned-phrase retry, assumed to fire ~15% of the time.
const JUDGES_PER_VARIANT = 3;

export function estimateCost(opts: CostPlanOpts): CostPlan {
  const variantsPerCase = opts.variantsPerCase ?? 1.7;
  const models = opts.pairwise ? 2 : 1;

  const composeCalls = Math.ceil(opts.cases * models * RETRY_FACTOR);
  const judgeCalls = opts.judgesEnabled
    ? Math.ceil(opts.cases * models * variantsPerCase * JUDGES_PER_VARIANT)
    : 0;

  const estimatedUsd = composeCalls * callUsd(opts.composeModel, "compose") + judgeCalls * callUsd(opts.judgeModel, "judge");

  return {
    composeCalls,
    judgeCalls,
    totalCalls: composeCalls + judgeCalls,
    estimatedUsd: Math.round(estimatedUsd * 100) / 100,
  };
}
