import type { MigrationDb } from "./types";

/**
 * Whether a composed day was kept, edited or thrown away — B2693. Counts
 * only: which variant (`close`/`story`/`none`), the outcome, and a capped
 * word-level edit distance between the composed text and what was actually
 * saved. Never the text itself.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("compose_outcomes")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("variant", "text", (c) => c.notNull())
    .addColumn("outcome", "text", (c) => c.notNull())
    .addColumn("edit_distance", "integer", (c) => c.notNull())
    .addColumn("occurred_at", "text", (c) => c.notNull())
    .execute();

  await db.schema.createIndex("compose_outcomes_owner").on("compose_outcomes").column("owner_id").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("compose_outcomes").execute();
}
