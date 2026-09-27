import type { MigrationDb } from "./types";

/**
 * `invite_suppressions` (045) and `message_switches` (046) are instance
 * state, but every table here carries `owner_id` so a journal deletion can
 * sweep `TABLE_NAMES` by it (lib/deletions.ts) — B2442/B2446. Both hold only
 * instance rows, written as `NO_JOURNAL` ("*"), so a deletion finds nothing
 * to remove in them, which is right: a suppressed address is the reader's
 * wish, not the journal's.
 */
export async function up(db: MigrationDb): Promise<void> {
  for (const table of ["invite_suppressions", "message_switches"]) {
    await db.schema
      .alterTable(table)
      .addColumn("owner_id", "text", (c) => c.notNull().defaultTo("*"))
      .execute();
  }
}

export async function down(db: MigrationDb): Promise<void> {
  for (const table of ["invite_suppressions", "message_switches"]) {
    await db.schema.alterTable(table).dropColumn("owner_id").execute();
  }
}
