import type { MigrationDb } from "./types";

/**
 * Cached tokens, split out of `input_tokens` — B1757.
 *
 * `lib/helper/model.ts:book` used to fold `cache_read_input_tokens` and
 * `cache_creation_input_tokens` straight into `input_tokens` at face value.
 * That overstated every figure: a cache read bills at 0.1x the input price
 * and a cache write at 1.25x, not 1x (Anthropic's published prompt-caching
 * rates). Two columns of their own let `priceUsage` (lib/instanceCosts.ts)
 * price each at its real multiple instead.
 *
 * **Existing rows are not backfilled.** There is nothing to split them
 * into: their cache tokens are already merged into `input_tokens` and which
 * fraction was cache cannot be recovered after the fact. Left alone, an old
 * row's two new columns default to 0 and it prices exactly as it did before
 * this migration — still overstated, same as always, rather than a total
 * that quietly changes for a month that already closed.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .alterTable("usage")
    .addColumn("cache_read_input_tokens", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema
    .alterTable("usage")
    .addColumn("cache_creation_input_tokens", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("usage").dropColumn("cache_creation_input_tokens").execute();
  await db.schema.alterTable("usage").dropColumn("cache_read_input_tokens").execute();
}
