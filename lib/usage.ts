import "server-only";
import { sql } from "kysely";
import { loadServerConfig } from "./config";
import { getDatabaseOrNull, newId, nowIso } from "./db";
import type { Operation } from "./operations";

/**
 * What the paid providers actually consumed — B746.
 *
 * ## What this is not
 *
 * It is not `paid/billing/lib/aiDays.ts`. That module is what a *journal* is
 * charged against — a plan's AI-day allowance, a count the owner can see and
 * a limit they agreed to by picking a plan. This file is what the *instance*
 * is billed, in tokens and seconds, and nobody agreed to it because nobody
 * chose it — a day written from four sentences and one written from four
 * hundred cost the same single AI day and very different money. Neither
 * number can be derived from the other, which is the whole reason both
 * exist.
 *
 * ## Two properties it is arranged around
 *
 * **1. Recording must never cost somebody their day.** Every write here is
 * called after the provider has already answered and is wrapped so that a
 * failure is swallowed. The person has spent an AI day and is owed their
 * write-up; losing it because an accounting insert hit a closed database
 * would be trading the product for the bookkeeping. A dropped row means the
 * operator's total is a little low for a month, which is recoverable, and the
 * alternative is not.
 *
 * **2. Units are recorded, never money.** A row holds tokens and seconds and
 * the model that produced them, and no price at all. Prices change, are
 * renegotiated, and differ per model; a row that stored francs would freeze
 * one afternoon's price list into the permanent record and could never be
 * re-costed. `lib/costs.ts` multiplies at read time, from a table the
 * operator edits in `site/config.json`.
 *
 * Nothing here is reachable from a journal's own pages, and nothing here is
 * shown to anybody but the instance admin (`lib/admin.ts`).
 */

/** Who is billed. A closed list; the column is text for the reason every
 *  other status column in this schema is. `twilio` since B2589 — an SMS send
 *  now leaves the same per-owner row an AI or speech call does. WhatsApp,
 *  Stannp and Gelato are deliberately not here yet: they already have their
 *  own instance-wide counters (`whatsapp_sends`, `print_orders`) that
 *  `lib/instanceCosts.ts`'s `sendCounts`/`printCosts` read directly, and
 *  adding a second row for the same send here would double-count it in
 *  `Dashboard.totalRappen` without a matching change there — left for the
 *  ticket that does that refactor rather than rushed in alongside this one. */
const PROVIDERS = ["anthropic", "deepgram", "twilio"] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * Anthropic's published prompt-caching multiples of the base input price —
 * not a number this repo chose. Shared with `priceUsage` (lib/instanceCosts.ts)
 * so a row priced at write time here and a row priced at read time there use
 * exactly the same arithmetic — B1757, B2589.
 */
export const CACHE_READ_MULTIPLE = 0.1;
export const CACHE_WRITE_MULTIPLE = 1.25;

export type { Operation };

export type UsageRecord = {
  owner: string;
  provider: Provider;
  model: string;
  operation: Operation;
  inputTokens?: number;
  outputTokens?: number;
  /** Tokens served from the prompt cache — billed at 0.1x the input price
   *  (see `priceUsage`, lib/instanceCosts.ts). Separate from `inputTokens`
   *  since B1757; before that they were folded in at face value. */
  cacheReadTokens?: number;
  /** Tokens written to the prompt cache — billed at 1.25x the input price.
   *  Separate from `inputTokens` since B1757. */
  cacheCreationTokens?: number;
  seconds?: number;
  /**
   * The price, when a future caller already knows it exactly — a WhatsApp
   * send priced from `costs.whatsappPerMessageRappen`, a print order's own
   * `cost_minor` converted to rappen (see the note on `PROVIDERS` above:
   * neither is wired up yet). Anthropic and Deepgram never set this:
   * `recordUsage` prices those two itself, from tokens/seconds and
   * `config.costs`. Absent and no automatic price applies (twilio today)
   * means the row is stored unpriced (`cost_rappen` null) — counted, not
   * guessed.
   */
  costRappen?: number;
};

/** What one call cost, in rappen, frozen at the moment of this insert — or
 *  `null` when this instance has no price for it. Exported for
 *  `test/usage-cost.test.ts`, which checks the arithmetic without a
 *  database. */
export function callCostRappen(record: UsageRecord): number | null {
  if (record.costRappen !== undefined) return Math.round(record.costRappen);
  const costs = loadServerConfig().costs;
  if (record.provider === "deepgram") {
    const perThousandMinutes = costs.transcriptionPerThousandMinutesRappen;
    if (!perThousandMinutes) return null;
    const minutes = count(record.seconds) / 60;
    return Math.round((minutes * perThousandMinutes) / 1000);
  }
  if (record.provider === "anthropic") {
    const price = costs.models[record.model];
    if (!price) return null;
    return Math.round(
      (count(record.inputTokens) * price.inputPerMillionRappen) / 1_000_000 +
        (count(record.outputTokens) * price.outputPerMillionRappen) / 1_000_000 +
        (count(record.cacheReadTokens) * price.inputPerMillionRappen * CACHE_READ_MULTIPLE) /
          1_000_000 +
        (count(record.cacheCreationTokens) * price.inputPerMillionRappen * CACHE_WRITE_MULTIPLE) /
          1_000_000,
    );
  }
  return null;
}

/** Whole, non-negative, and never NaN — a provider that answers with
 *  something unexpected records a zero rather than poisoning a SUM. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Record one call. **Never throws, and never rejects.**
 *
 * Property 1 above is enforced here rather than at each of the four call
 * sites, so a fifth call site added next year cannot forget it: the whole
 * body is inside a `try`. Without a database — a fresh clone, a test, a
 * checkout with no `DATABASE_URL` — this is a no-op, which is the same shape
 * billing's own database reads take when billing is off, and for the same
 * reason: a disabled capability is absent rather than broken.
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    const handle = await getDatabaseOrNull();
    if (!handle) return;
    await handle.db
      .insertInto("usage")
      .values({
        id: newId(),
        owner_id: record.owner,
        provider: record.provider,
        model: record.model,
        operation: record.operation,
        input_tokens: count(record.inputTokens),
        output_tokens: count(record.outputTokens),
        cache_read_input_tokens: count(record.cacheReadTokens),
        cache_creation_input_tokens: count(record.cacheCreationTokens),
        seconds: count(record.seconds),
        cost_rappen: callCostRappen(record),
        created_at: nowIso(),
      })
      .execute();
  } catch {
    // Deliberately silent. See property 1: the person's day has already been
    // written and this row is the operator's bookkeeping, not theirs.
  }
}

/** One line of the dashboard: everything billed for one provider, model and
 *  operation over the period asked for. */
export type UsageTotal = {
  provider: string;
  model: string;
  operation: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** See `UsageRecord.cacheReadTokens`/`cacheCreationTokens` — 0 for rows
   *  written before B1757, which is what leaves their tokens priced (still
   *  overstated) inside `inputTokens` instead. */
  cacheReadTokens: number;
  cacheCreationTokens: number;
  seconds: number;
  /** The sum of every contributing row's own `cost_rappen` — B2589. Only
   *  trustworthy when `pricedRows === calls`; see `priceUsage`
   *  (lib/instanceCosts.ts), the one reader of this pair. */
  costRappenKnown: number;
  /** How many of `calls` actually carried a `cost_rappen` — the rest are
   *  legacy rows from before B2589 and were never priced at write time. */
  pricedRows: number;
};

/**
 * Everything consumed since `since`, grouped so the dashboard can price each
 * line against the model it names.
 *
 * Grouped in SQL rather than by reading rows and reducing in JS: a busy month
 * is tens of thousands of rows, and the answer is a dozen lines whatever the
 * period. `since` is an ISO instant, compared as text — which sorts correctly
 * because `nowIso()` writes UTC with a fixed number of digits.
 */
export async function usageSince(since: string, owner?: string): Promise<UsageTotal[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  let query = handle.db
    .selectFrom("usage")
    .select(({ fn }) => [
      "provider",
      "model",
      "operation",
      fn.countAll<number>().as("calls"),
      fn.sum<number>("input_tokens").as("input_tokens"),
      fn.sum<number>("output_tokens").as("output_tokens"),
      fn.sum<number>("cache_read_input_tokens").as("cache_read_input_tokens"),
      fn.sum<number>("cache_creation_input_tokens").as("cache_creation_input_tokens"),
      fn.sum<number>("seconds").as("seconds"),
      fn.sum<number>("cost_rappen").as("cost_rappen"),
      // COUNT(column) ignores NULLs on both dialects — the rows this bucket
      // actually has a frozen price for, out of `calls`.
      fn.count<number>("cost_rappen").as("priced_rows"),
    ])
    .where("created_at", ">=", since)
    .groupBy(["provider", "model", "operation"])
    .orderBy("provider")
    .orderBy("operation");
  if (owner) query = query.where("owner_id", "=", owner);
  const rows = await query.execute();
  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    // Postgres returns a bigint for count/sum and the driver hands it back as
    // a string; SQLite returns a number. Number() is correct on both and the
    // reason these are not used raw.
    calls: Number(row.calls ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheReadTokens: Number(row.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(row.cache_creation_input_tokens ?? 0),
    seconds: Number(row.seconds ?? 0),
    costRappenKnown: Number(row.cost_rappen ?? 0),
    pricedRows: Number(row.priced_rows ?? 0),
  }));
}

/**
 * The same totals, per journal — the question that follows the total.
 *
 * Deliberately not per model: "which journal is costing the money" is
 * answered by one number each, and a per-journal-per-model breakdown is a
 * table nobody reads. The per-model prices are applied by the caller, which
 * is why the model comes back at all.
 */
export async function usageByOwnerSince(
  since: string,
): Promise<{ owner: string; totals: UsageTotal[] }[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("usage")
    .select(({ fn }) => [
      "owner_id",
      "provider",
      "model",
      "operation",
      fn.countAll<number>().as("calls"),
      fn.sum<number>("input_tokens").as("input_tokens"),
      fn.sum<number>("output_tokens").as("output_tokens"),
      fn.sum<number>("cache_read_input_tokens").as("cache_read_input_tokens"),
      fn.sum<number>("cache_creation_input_tokens").as("cache_creation_input_tokens"),
      fn.sum<number>("seconds").as("seconds"),
      fn.sum<number>("cost_rappen").as("cost_rappen"),
      fn.count<number>("cost_rappen").as("priced_rows"),
    ])
    .where("created_at", ">=", since)
    .groupBy(["owner_id", "provider", "model", "operation"])
    .orderBy("owner_id")
    .execute();

  const byOwner = new Map<string, UsageTotal[]>();
  for (const row of rows) {
    const list = byOwner.get(row.owner_id) ?? [];
    list.push({
      provider: row.provider,
      model: row.model,
      operation: row.operation,
      calls: Number(row.calls ?? 0),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_input_tokens ?? 0),
      cacheCreationTokens: Number(row.cache_creation_input_tokens ?? 0),
      seconds: Number(row.seconds ?? 0),
      costRappenKnown: Number(row.cost_rappen ?? 0),
      pricedRows: Number(row.priced_rows ?? 0),
    });
    byOwner.set(row.owner_id, list);
  }
  return [...byOwner.entries()].map(([owner, totals]) => ({ owner, totals }));
}

/** One day's consumption, for the trend on `/admin` — B763. */
export type UsageDay = {
  /** `YYYY-MM-DD`, UTC, as `created_at` was written. */
  date: string;
  provider: string;
  model: string;
  /** Which feature spent it — B996. The column was always on the row and was
   *  simply not grouped by; adding it to the `GROUP BY` costs one more column
   *  in an answer that is already a dozen rows a day, and is what lets the
   *  chart say *what* grew rather than only that something did. */
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  seconds: number;
};

/**
 * The same rows as `usageSince`, bucketed by day — B763.
 *
 * **`substr(created_at, 1, 10)` rather than a date function**, because that
 * expression is spelled identically on SQLite and on Postgres and both answer
 * it the same way over ISO text. `date_trunc` is Postgres-only and `date()` is
 * SQLite-only, so either would have put a dialect fork in a file that has no
 * business knowing which database is running — the rule AGENTS.md sets for
 * everything outside `lib/db/`.
 *
 * Bucketed in UTC, which is what `nowIso()` writes. A day boundary an hour off
 * the operator's own midnight is not worth a timezone to carry: the shape of a
 * month is the question, not which side of midnight one call landed.
 *
 * Provider and model come back because the caller prices them, and a model
 * swapped mid-window must be priced at its own rate on the days it ran.
 */
export async function usageDailySince(since: string): Promise<UsageDay[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const day = sql<string>`substr(created_at, 1, 10)`;
  const rows = await handle.db
    .selectFrom("usage")
    .select(({ fn }) => [
      day.as("day"),
      "provider",
      "model",
      "operation",
      fn.sum<number>("input_tokens").as("input_tokens"),
      fn.sum<number>("output_tokens").as("output_tokens"),
      fn.sum<number>("cache_read_input_tokens").as("cache_read_input_tokens"),
      fn.sum<number>("cache_creation_input_tokens").as("cache_creation_input_tokens"),
      fn.sum<number>("seconds").as("seconds"),
    ])
    .where("created_at", ">=", since)
    .groupBy([day, "provider", "model", "operation"])
    .orderBy(day)
    .execute();

  return rows.map((row) => ({
    date: String(row.day),
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheReadTokens: Number(row.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(row.cache_creation_input_tokens ?? 0),
    seconds: Number(row.seconds ?? 0),
  }));
}

/** One journal's consumption on one day — the sparkline on its row, B996. */
export type OwnerDay = {
  date: string;
  owner: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  seconds: number;
};

/**
 * The daily series again, per journal — B996.
 *
 * A separate query rather than one more column on `usageDailySince`, because
 * the two multiply: thirty days by thirty-five journals by two models by seven
 * operations is a five-figure answer to a question about a sparkline. Grouped
 * without the operation, which is the column this one does not need.
 */
export async function usageDailyByOwnerSince(since: string): Promise<OwnerDay[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const day = sql<string>`substr(created_at, 1, 10)`;
  const rows = await handle.db
    .selectFrom("usage")
    .select(({ fn }) => [
      day.as("day"),
      "owner_id",
      "provider",
      "model",
      fn.sum<number>("input_tokens").as("input_tokens"),
      fn.sum<number>("output_tokens").as("output_tokens"),
      fn.sum<number>("cache_read_input_tokens").as("cache_read_input_tokens"),
      fn.sum<number>("cache_creation_input_tokens").as("cache_creation_input_tokens"),
      fn.sum<number>("seconds").as("seconds"),
    ])
    .where("created_at", ">=", since)
    .groupBy([day, "owner_id", "provider", "model"])
    .orderBy(day)
    .execute();

  return rows.map((row) => ({
    date: String(row.day),
    owner: row.owner_id,
    provider: row.provider,
    model: row.model,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheReadTokens: Number(row.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(row.cache_creation_input_tokens ?? 0),
    seconds: Number(row.seconds ?? 0),
  }));
}
