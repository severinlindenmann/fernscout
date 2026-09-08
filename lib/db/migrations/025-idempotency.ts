import type { MigrationDb } from "./types";

/**
 * Replay protection that survives a restart — B718.
 *
 * `lib/idempotency.ts` kept its answers in a per-process `Map`, which was an
 * honest trade while the filesystem was the backstop underneath it: a replayed
 * day write finds the day already on disk and cannot write it twice. The
 * helper's metered routes broke that assumption. They spend a credit, call a
 * model and write nothing to disk, so a retry after a restart — or on a second
 * Node process — was a fresh key and a second charge for the same words.
 *
 * `id` is the composed key `<owner> <tool> <supplied>` from `idempotencyKey()`,
 * not a generated one: the whole point is that the caller's own key finds the
 * row. `owner_id` is the journal, so the deletion sweep in `lib/deletions.ts`
 * takes these with it like every other table.
 *
 * `value` is the JSON of the answer that was handed back the first time, and
 * `fingerprint` is what the call was, so the same key with different arguments
 * is still a conflict rather than a wrong replay.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("idempotency")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("fingerprint", "text", (c) => c.notNull())
    .addColumn("value", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  // The one question apart from the primary key: what is old enough to drop.
  await db.schema
    .createIndex("idempotency_created")
    .on("idempotency")
    .columns(["created_at"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("idempotency_created").execute();
  await db.schema.dropTable("idempotency").execute();
}
