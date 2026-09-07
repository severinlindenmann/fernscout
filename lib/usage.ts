import "server-only";
import { sql } from "kysely";
import { getDatabaseOrNull, newId, nowIso } from "./db";

/**
 * What the paid providers actually consumed — B746.
 *
 * ## What this is not
 *
 * It is not `lib/credits.ts`. That file is what a *journal* is charged, in
 * credits, and it is a price the owner agreed to before the button. This file
 * is what the *instance* is billed, in tokens and seconds, and nobody agreed
 * to it because nobody chose it — a day written from four sentences and one
 * written from four hundred cost the same single credit and very different
 * money. Neither number can be derived from the other, which is the whole
 * reason both exist.
 *
 * ## Two properties it is arranged around
 *
 * **1. Recording must never cost somebody their day.** Every write here is
 * called after the provider has already answered and is wrapped so that a
 * failure is swallowed. The person has spent a credit and is owed their
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
 *  other status column in this schema is. */
const PROVIDERS = ["anthropic", "deepgram"] as const;
type Provider = (typeof PROVIDERS)[number];

/** Which call site spent it, so a bill can be attributed to a feature. */
const OPERATIONS = [
  "write_day",
  "describe_photos",
  "route_ask",
  // B889 — one turn of the thread. Several per conversation, and a turn that
  // calls a tool books twice: the loop re-sends everything it has.
  "ask_thread",
  "transcribe",
  // B689 — one call per statement, whatever its length: the model returns a
  // column mapping and code applies it to every row.
  "map_statement",
] as const;
export type Operation = (typeof OPERATIONS)[number];

export type UsageRecord = {
  owner: string;
  provider: Provider;
  model: string;
  operation: Operation;
  inputTokens?: number;
  outputTokens?: number;
  seconds?: number;
};

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
 * `spend` and `balanceOf` take when credits are off, and for the same reason:
 * a disabled capability is absent rather than broken.
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
        seconds: count(record.seconds),
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
  seconds: number;
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
      fn.sum<number>("seconds").as("seconds"),
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
    seconds: Number(row.seconds ?? 0),
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
      fn.sum<number>("seconds").as("seconds"),
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
      seconds: Number(row.seconds ?? 0),
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
  inputTokens: number;
  outputTokens: number;
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
      fn.sum<number>("input_tokens").as("input_tokens"),
      fn.sum<number>("output_tokens").as("output_tokens"),
      fn.sum<number>("seconds").as("seconds"),
    ])
    .where("created_at", ">=", since)
    .groupBy([day, "provider", "model"])
    .orderBy(day)
    .execute();

  return rows.map((row) => ({
    date: String(row.day),
    provider: row.provider,
    model: row.model,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    seconds: Number(row.seconds ?? 0),
  }));
}
