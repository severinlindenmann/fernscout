import type { MigrationDb } from "./types";

/**
 * SMS bodies, gone — B2589.
 *
 * `sms_messages` (031) kept the full text of every SMS this instance ever
 * sent or received, forever, with owner `*` — a passcode, a welcome link, a
 * reader's own reply, all sitting in the database in the clear. The table
 * still answers "what happened on this number" (`lib/sms/store.ts`), which
 * needs direction, numbers and timing, never the words. Blanking existing
 * rows rather than dropping the column: `lib/sms/store.ts` still writes and
 * reads a `body` field so the table shape does not change underneath it,
 * and a blank string is what every row gets going forward.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.updateTable("sms_messages").set({ body: "" }).execute();
}

export async function down(): Promise<void> {
  // The text is gone; there is nothing to restore.
}
