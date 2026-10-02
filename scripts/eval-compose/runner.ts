import "server-only";
import crypto from "node:crypto";
import { getDatabaseOrNull } from "../../lib/db";
import { composeDay, ComposeRejected } from "../../lib/helper/compose";
import { packText } from "../../lib/helper/dayContext";
import { bannedPhraseCheck } from "./judges";
import type { CaseDump, EvalCase, PairwiseDump, VariantDump } from "./types";

/**
 * Runs `composeDay` for real — the only place in this harness that spends
 * API money, and only when the caller (`run.mts`) has already passed the
 * `EVAL_CONFIRM` gate. Concurrency 3: `composeDay` already makes up to two
 * calls itself (the banned-phrase retry), so three cases in flight is
 * already up to six requests at once.
 *
 * Tokens and cost come from the usage ledger (`lib/usage.ts`), not from
 * `composeDay`'s return value — it books its own call under `write_day` and
 * returns nothing about tokens. Each case is attributed to a run-unique
 * `owner` id (`eval:<runId>:<caseId>`), so this reads back exactly its own
 * rows with no other call in flight able to collide. **Without a database
 * configured (`DATABASE_URL`/SQLite default unset), `recordUsage` is a
 * silent no-op (see its own header comment) and this file has nothing to
 * read back** — tokens/cost come back `null`, which `report.ts` shows as
 * "unknown" rather than zero.
 */

function concurrently<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await run(items[i]);
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)).then(() => results);
}

async function usageFor(ownerId: string): Promise<{ inputTokens: number | null; outputTokens: number | null; costUsd: number | null }> {
  const handle = await getDatabaseOrNull();
  if (!handle) return { inputTokens: null, outputTokens: null, costUsd: null };
  const rows = await handle.db
    .selectFrom("usage")
    .select(["input_tokens", "output_tokens", "cost_rappen"])
    .where("owner_id", "=", ownerId)
    .where("operation", "=", "write_day")
    .execute();
  if (rows.length === 0) return { inputTokens: null, outputTokens: null, costUsd: null };
  const inputTokens = rows.reduce((s, r) => s + r.input_tokens, 0);
  const outputTokens = rows.reduce((s, r) => s + r.output_tokens, 0);
  const rappen = rows.every((r) => r.cost_rappen !== null) ? rows.reduce((s, r) => s + (r.cost_rappen ?? 0), 0) : null;
  // CHF and the dollar are kept at 1:1 here — close enough for a run report,
  // and `lib/costs.ts`'s own real conversion is a display-layer concern this
  // script has no reason to import.
  const costUsd = rappen === null ? null : Math.round(rappen) / 100;
  return { inputTokens, outputTokens, costUsd };
}

function toVariantDump(slot: "close" | "story", variant: { titles: { text: string; kind: string }[]; text: string; sentences: { text: string; sources: { id: string }[] }[] } | null, languages: string[], notes: string): VariantDump | null {
  if (!variant) return null;
  return {
    slot,
    titles: variant.titles,
    text: variant.text,
    sentences: variant.sentences.map((s) => ({ text: s.text, sources: s.sources.map((src) => src.id) })),
    bannedPhraseHits: bannedPhraseCheck(variant.text, languages, notes).hits,
  };
}

/** One case, one model. Never throws — a `ComposeRejected` or any other
 *  error becomes `ok: false` with the reason, exactly like the route
 *  `composeDay`'s own caller does with its 422. */
async function runOne(evalCase: EvalCase, runId: string, model: string): Promise<CaseDump> {
  const ownerId = `eval:${runId}:${evalCase.id}`;
  const notesText = packText(evalCase.pack)
    .filter((i) => /^[na]\d+$/.test(i.id) || i.id.endsWith("-caption"))
    .map((i) => i.text);
  const started = Date.now();
  try {
    const composed = await composeDay(evalCase.pack, { existingTags: evalCase.existingTags, owner: ownerId });
    const latencyMs = Date.now() - started;
    const usage = await usageFor(ownerId);
    const languages = [composed.language, evalCase.pack.journal.language];
    const variants = [
      toVariantDump("close", composed.close, languages, notesText.join("\n")),
      toVariantDump("story", composed.story, languages, notesText.join("\n")),
    ].filter((v): v is VariantDump => v !== null);
    return {
      caseId: evalCase.id,
      label: evalCase.label,
      source: evalCase.source,
      model,
      notes: notesText,
      pack: evalCase.pack,
      published: evalCase.published,
      ok: true,
      dropped: composed.dropped,
      variants,
      tags: composed.tags,
      missing: composed.missing,
      latencyMs,
      ...usage,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const usage = await usageFor(ownerId);
    return {
      caseId: evalCase.id,
      label: evalCase.label,
      source: evalCase.source,
      model,
      notes: notesText,
      pack: evalCase.pack,
      published: evalCase.published,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      dropped: err instanceof ComposeRejected ? err.reasons : [],
      variants: [],
      tags: [],
      missing: [],
      latencyMs,
      ...usage,
    };
  }
}

/** Sets `ASSISTANT_MODEL_COMPOSE` for the whole batch, not per call —
 *  `composeDay` reads it at call time (`modelFor("compose")`), and every
 *  case in one batch wants the same model, so this is set once around the
 *  concurrent group rather than per `runOne`, which would race: a call
 *  finishing first must not reset the variable while its siblings' own
 *  retry (composeDay's one banned-phrase retry) is still reading it. */
async function withComposeModel<R>(model: string, run: () => Promise<R>): Promise<R> {
  const previous = process.env.ASSISTANT_MODEL_COMPOSE;
  process.env.ASSISTANT_MODEL_COMPOSE = model;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.ASSISTANT_MODEL_COMPOSE;
    else process.env.ASSISTANT_MODEL_COMPOSE = previous;
  }
}

/** Single-model run: one `CaseDump` per case, concurrency 3. */
export async function runAll(cases: EvalCase[], model: string): Promise<CaseDump[]> {
  const runId = crypto.randomUUID().slice(0, 8);
  return withComposeModel(model, () => concurrently(cases, 3, (c) => runOne(c, runId, model)));
}

/**
 * Pairwise run: model A over every case, then model B over every case —
 * sequential passes (each internally concurrency 3), because the override
 * that picks the model is process-global and `composeDay` takes no model
 * argument of its own. Two concurrent passes on two different models would
 * race that one environment variable.
 */
export async function runPairwise(cases: EvalCase[], modelA: string, modelB: string): Promise<PairwiseDump[]> {
  const runId = crypto.randomUUID().slice(0, 8);
  const a = await withComposeModel(modelA, () => concurrently(cases, 3, (c) => runOne(c, `${runId}-a`, modelA)));
  const b = await withComposeModel(modelB, () => concurrently(cases, 3, (c) => runOne(c, `${runId}-b`, modelB)));
  const byIdB = new Map(b.map((r) => [r.caseId, r]));
  return cases.map((c, i) => ({
    caseId: c.id,
    label: c.label,
    notes: a[i].notes,
    modelA,
    modelB,
    outputA: a[i],
    outputB: byIdB.get(c.id)!,
  }));
}
