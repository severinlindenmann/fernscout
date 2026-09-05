import type { MigrationDb } from "./types";

/**
 * One mock payment, so the "buy credits" flow has somewhere to remember a
 * transaction between the moment it is started and the moment somebody comes
 * back to the link — B405.
 *
 * B368 mailed a link to a static page and kept no state. The owner wanted a
 * transaction they can leave and return to: a page that shows a transaction id
 * and a status, reachable from an email, payable now or later. That needs a
 * row.
 *
 * ## Why this table exists and still grants nothing
 *
 * `credits.balance` is raised by exactly one function, `grant()`, called from
 * one shell script — that invariant (B366) is unchanged and is the reason a
 * card can be wired to this later without fear. This table records that a
 * purchase was *started* and *marked paid in a preview*; it never touches a
 * balance or the ledger. When a real provider lands, a verified server-to-
 * server webhook will be the thing that reads a `paid` row and grants — never
 * the browser. So `status: "paid"` here means "the mock Pay button was
 * pressed", not "credits were added".
 *
 * `id` is a random, unguessable token: it is the URL segment and the emailed
 * link, and it is the whole capability to view or mark-paid this one
 * transaction. That capability adds no credits and exposes only this
 * purchase's own amount and status, so it is stored as-is rather than hashed —
 * it is a hard-to-guess handle, not a password.
 *
 * `owner_id` is the username (the tenant boundary, per `lib/db/owner.ts`), and
 * every read is scoped by it so one journal's payment id cannot be viewed
 * under another journal's path.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("payments")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("credits", "integer", (c) => c.notNull())
    // Integer rappen, never a float — the same money rule the ledger follows.
    .addColumn("amount_rappen", "integer", (c) => c.notNull())
    // "pending" | "paid". Plain text, for the reason `users.role` gives: the
    // typed alternative needs `create type` on Postgres and has no SQLite form.
    .addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
    // "twint" | "card", chosen at the Pay step; null until then.
    .addColumn("method", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("paid_at", "text")
    .execute();

  // The only listing this table needs is "this journal's payments, newest
  // first" (an operator glance); every request-path read is by primary key.
  await db.schema
    .createIndex("payments_owner")
    .on("payments")
    .columns(["owner_id", "created_at"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("payments_owner").execute();
  await db.schema.dropTable("payments").execute();
}
