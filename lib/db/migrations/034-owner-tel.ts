import type { MigrationDb } from "./types";

/**
 * The owner's own telephone number, moved out of `config.json` — B1654.
 *
 * `owner.email` stays in the file: it is the journal's own statement of who
 * owns it, and a database drop must not orphan a journal — see B1654 for
 * the owner's full reasoning. `owner.tel` is different — a notification
 * channel, not an ownership claim — so it is allowed to live where a drop
 * *can* lose it: an inconvenience (WhatsApp stops until the number is
 * re-proven) rather than an orphaned journal.
 *
 * One row per journal, like `credits` (`016-credits`) — `owner_id` (the
 * username) is the primary key, so there is never a second row for the same
 * journal to disagree with the first.
 *
 * `tel` is nullable rather than the row simply being absent for "no number",
 * because absence has to mean two different things and only one row shape
 * can hold both: **no row at all** is "nothing has touched this journal's
 * number since this table existed" — `lib/ownerTel.ts` falls back to
 * whatever `config.json` already carries, which is how a number already on
 * disk keeps working with no migration script. A row **with `tel` null** is
 * "this was explicitly cleared through the v2 door" — it must NOT fall back
 * to the file, or clearing a number would be undone by the next read.
 *
 * `proven_method` is `sms` | `operator` | `whatsapp-inbound` | `agent` — the
 * first three are v1's own words (`Owner.telProvenMethod` in `lib/config.ts`),
 * carried over so a number already proven that way keeps meaning what it did.
 * `agent` is new: a number typed into the v2 door by an agent, which is a
 * weaker claim than one a passcode or an inbound message proved — the same
 * distinction B1654 asks this store to be able to make. `lib/ownerTel.ts`
 * validates the closed list; this column is `text` for the reason every
 * other status column in this schema is (see `lib/db/schema.ts`).
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("owner_tel")
    .addColumn("owner_id", "text", (c) => c.primaryKey().notNull())
    .addColumn("tel", "text")
    .addColumn("proven_at", "text")
    .addColumn("proven_method", "text")
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("owner_tel").execute();
}
