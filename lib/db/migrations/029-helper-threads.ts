import type { MigrationDb } from "./types";

/**
 * The helper's live conversation, durable — B1054.
 *
 * `helper_sessions` (026) is an append-only record of what happened — turns
 * and presses, kept forever. This is the other half: the *mutable* state a
 * turn is actually answered against — which conversation is live for a
 * journal right now, its recent turns (including the model-only notes
 * `helper_sessions` never stored), and when it goes stale. One row per
 * journal, because "one conversation per journal, not per device" is a
 * property `lib/helper/thread.ts` already had and this keeps: a second
 * browser tab, or a WhatsApp message, continues the same row rather than
 * starting a rival one.
 *
 * **No locking, deliberately** (the owner's own decision on B1054): two
 * doors writing within the same instant is rare for one person, and the
 * origin column on each turn makes it legible after the fact rather than
 * needing to be prevented.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("helper_threads")
    .addColumn("owner_id", "text", (c) => c.primaryKey().notNull())
    // The id `history()`/`liveSession()` hand back — the same one
    // `helper_sessions` rows are grouped by, so a turn recorded through
    // either door lands under the conversation a person would recognise.
    .addColumn("session_id", "text", (c) => c.notNull())
    // Which door most recently touched this thread — "web" or "whatsapp" —
    // because the TTL is per channel (a messenger is read once at the end of
    // a day; a browser room is a sitting). The channel of the *last* turn
    // decides how long the thread stays live.
    .addColumn("channel", "text", (c) => c.notNull().defaultTo("web"))
    // JSON of the twelve-turn window (`Turn[]`, including notes) — the exact
    // shape the model is handed, so a restart hands it the same thing again.
    .addColumn("turns", "text", (c) => c.notNull().defaultTo("[]"))
    .addColumn("touched_at", "text", (c) => c.notNull())
    .execute();

  // Which door said or heard this turn — "web" | "whatsapp" | "" for every
  // row written before this migration, which nobody marked. Kept on the
  // append-only record too, not only on the live `turns` blob above: a
  // conversation's origin is a fact worth having after the thread itself has
  // expired.
  await db.schema
    .alterTable("helper_sessions")
    .addColumn("origin", "text", (c) => c.notNull().defaultTo(""))
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("helper_threads").execute();
  await db.schema.alterTable("helper_sessions").dropColumn("origin").execute();
}
