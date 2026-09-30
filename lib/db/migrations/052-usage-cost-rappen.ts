import type { MigrationDb } from "./types";

/**
 * The price, frozen at the moment of the call — B2589.
 *
 * `usage` used to store only what was consumed (tokens, seconds) and
 * `priceUsage` (lib/instanceCosts.ts) multiplied by `config.costs` at *read*
 * time, on every page load. That means a price the operator edits today
 * silently reprices every call ever made — a January bill that changes
 * because February's rate changed. This column is what `recordUsage`
 * (lib/usage.ts) computes and stores once, at write time, so a row's cost is
 * a fact about the call rather than a fact about today's config.
 *
 * **Nullable, and NULL means "not priced at write time"** — every row
 * written before this migration, and any row this instance genuinely has no
 * price for (an unpriced model, `transcriptionPerThousandMinutesRappen`
 * left at 0). `priceUsage` falls back to its old read-time arithmetic only
 * when a bucket contains such a row, so an old month still prices the way it
 * always did and a new one is frozen.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("usage").addColumn("cost_rappen", "integer").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("usage").dropColumn("cost_rappen").execute();
}
