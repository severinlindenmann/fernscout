import type { DayPack } from "../../lib/helper/dayContext";

/**
 * Shared shapes for the compose eval harness — B2692.
 *
 * Kept in their own file with no `server-only` import so the pure pieces
 * (`select-cases.ts`, `cost.ts`, `pairwise.ts`, the banned-phrase check in
 * `judges.ts`) can be unit-tested under the plain suite, which does not stub
 * `server-only` unless a file needs it.
 */

/** One day to run through `composeDay` — a real day read from someone's own
 *  content (`source: "golden"`) or a hand-written synthetic fixture
 *  (`source: "hard"`). Either way, `pack` is exactly what `composeDay` takes. */
export type EvalCase = {
  id: string;
  source: "golden" | "hard";
  label: string;
  pack: DayPack;
  existingTags?: string[];
  /** The owner's own published text, for a golden case only — never
   *  fabricated for a hard case, and never fed to the model: it is read
   *  afterwards, by a person comparing, not a guard input. */
  published?: string;
};

/** One produced variant, exactly as dumped to `cases.jsonl` for judging —
 *  by an API judge (`EVAL_JUDGE=api`) or by a person/subagent reading the
 *  file. `sources` is kept per sentence so a grounding judge can cite a
 *  pack id without re-deriving it from the pack. */
export type VariantDump = {
  slot: "close" | "story";
  titles: { text: string; kind: string }[];
  text: string;
  sentences: { text: string; sources: string[] }[];
  /** The deterministic regex check (`composeGuard.bannedHits`, re-run here
   *  for visibility) — phrases found, empty when clean. Never needs a judge. */
  bannedPhraseHits: string[];
};

/** One case's full run, as a line in `cases.jsonl` — what a grounding,
 *  summing-up or would-publish judge reads, whether that judge is this
 *  file's optional API path or a person/subagent off the filesystem. */
export type CaseDump = {
  caseId: string;
  label: string;
  source: "golden" | "hard";
  model: string;
  /** The owner's own words, flattened — the thing a "would you publish
   *  this?" judge actually compares the output against. */
  notes: string[];
  /** The day pack `composeDay` actually saw, for a judge that wants more
   *  than the notes (weather, photos, companions, neighbouring days). */
  pack: unknown;
  published?: string;
  ok: boolean;
  /** `ComposeRejected`'s reasons, or a thrown error's message — set only
   *  when `ok` is false and nothing was produced to judge. */
  error?: string;
  dropped: string[];
  variants: VariantDump[];
  tags: string[];
  missing: { question: string; about: string }[];
  latencyMs: number;
  /** From the usage ledger, when a database is configured — see
   *  `runner.ts`'s header comment for why this can be `null`. */
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

/** One line of `pairwise.jsonl` — both models' output for one case, side by
 *  side, for an external judge to compare in both orders. */
export type PairwiseDump = {
  caseId: string;
  label: string;
  notes: string[];
  modelA: string;
  modelB: string;
  outputA: CaseDump;
  outputB: CaseDump;
};

/** One line a judge (API or external) writes to `verdicts.jsonl`, per case
 *  and surviving variant — the exact shape `judge-instructions.md` asks
 *  for. `grounding` lists every factual claim with the pack id that backs
 *  it, or `"UNSUPPORTED"`; pass iff nothing is unsupported. The banned-word
 *  check is never the judge's job — it is already in `cases.jsonl` as
 *  `bannedPhraseHits` — so `endsWithSummingUp` is the only yes/no left for
 *  judge (b). */
export type VerdictRecord = {
  caseId: string;
  variant: "close" | "story";
  grounding: { pass: boolean; claims: { text: string; sourceId: string | "UNSUPPORTED" }[] };
  endsWithSummingUp: boolean;
  wouldPublish: { pass: boolean; critique: string };
};

/** One case's pairwise comparison, both orders, after `fromVerdictRecords`
 *  has matched an `"AB"` and a `"BA"` row together — `order1` is what the
 *  (A, B) call picked, `order2` is what the (B, A) call picked, each
 *  already in that call's own `"first"`/`"second"`/`"tie"` terms. */
export type PairwiseCaseResult = {
  caseId: string;
  label: string;
  order1: "first" | "second" | "tie";
  order2: "first" | "second" | "tie";
};

/** One line a judge writes to `pairwise-verdicts.jsonl`, one per (case,
 *  order). `pick` is which side of *that* call's order the judge preferred
 *  — `"first"`, `"second"` or `"tie"` — never "A"/"B" directly, so the swap
 *  rule (`pairwise.ts`) is applied once, in one place, from the dump's own
 *  `modelA`/`modelB`. */
export type PairwiseVerdictRecord = {
  caseId: string;
  order: "AB" | "BA";
  pick: "first" | "second" | "tie";
  note: string;
};
