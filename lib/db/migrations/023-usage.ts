import type { MigrationDb } from "./types";

/**
 * What one call to a paid provider actually consumed — B746.
 *
 * **Why this cannot be read off `credit_ledger`.** The ledger is what a
 * *journal* was charged: one credit for a write-up, whatever the day was.
 * This table is what the *instance* was charged, which is a different number
 * measured in different units — a one-line day and a thousand-word one cost
 * the same credit and very different money. Without this table the tokens are
 * unrecoverable the moment the response is discarded, and the only remaining
 * answer to "what did last month cost" is a card statement.
 *
 * Append-only, the same shape as `credit_ledger` and for the same reason: it
 * is an accounting record, so a row is never updated and never deleted except
 * with the journal it belongs to.
 *
 * **Three unit columns rather than one, because the units are not
 * commensurable.** Input tokens and output tokens are priced differently by
 * every provider that sells them, and audio is sold by the second. Folding
 * them into one `amount` plus a `unit` string would make the price join a
 * runtime decision and the sum of a period meaningless. Each is zero where it
 * does not apply.
 *
 * `owner_id` is the **username** — the journal whose person made the request,
 * per the first convention in `lib/db/owner.ts` — so the page can answer
 * "which journal is costing the money", which is the question after the total.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("usage")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    // "anthropic" | "deepgram". Text for the reason every other status column
    // in this schema is text: Postgres needs `create type` for a fixed value
    // list and SQLite has no such thing at all. The closed list lives in
    // PROVIDERS in lib/usage.ts, where a test can read it.
    .addColumn("provider", "text", (c) => c.notNull())
    // The model or product actually billed — "claude-haiku-4-5", "nova-3".
    // Stored per row rather than looked up later: a price list is indexed by
    // it, and a model swapped next month must not re-price last month.
    .addColumn("model", "text", (c) => c.notNull())
    // Which call site. "write_day" | "describe_photos" | "route_ask" |
    // "transcribe" — so a bill can be attributed to a feature, not only to a
    // provider.
    .addColumn("operation", "text", (c) => c.notNull())
    .addColumn("input_tokens", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("output_tokens", "integer", (c) => c.notNull().defaultTo(0))
    // Audio, in whole seconds as the provider measured it — never as the
    // caller claimed it.
    .addColumn("seconds", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  // The only two questions this table is asked: a period's rows, and one
  // journal's rows within it.
  await db.schema.createIndex("usage_created").on("usage").columns(["created_at"]).execute();
  await db.schema.createIndex("usage_owner").on("usage").columns(["owner_id", "created_at"]).execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("usage_owner").execute();
  await db.schema.dropIndex("usage_created").execute();
  await db.schema.dropTable("usage").execute();
}
