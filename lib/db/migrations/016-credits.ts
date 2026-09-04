import type { MigrationDb } from "./types";

/**
 * What a journal has left to spend, and where every credit of it came from.
 *
 * B366. Every letter `lib/digest/dayLetter.ts` sends and every WhatsApp
 * `lib/digest/dayWhatsapp.ts` sends is billed to one credit card, and until
 * this migration nothing in the schema knew that. A journal with four hundred
 * approved contacts publishing fifteen days is eight thousand sends nobody
 * counted.
 *
 * ## Why two tables and not one
 *
 * `credit_ledger` alone would be the tidier design — append-only, every grant
 * and every spend, balance derived as `SUM(delta)`. It cannot be used on its
 * own, because the one property this schema exists to guarantee is that a
 * balance never goes below zero **under concurrency**, and there is no
 * portable way to insert a row conditional on a `SUM()` across both dialects:
 * SQLite has no `SELECT … FOR UPDATE`, and a read-then-write in application
 * code is exactly the race that lets two publish calls each see ten credits,
 * each decide ten is enough for eight, and send sixteen.
 *
 * So `credits.balance` is a single row per journal, and the debit is one
 * statement:
 *
 * ```sql
 * UPDATE credits SET balance = balance - :n WHERE owner_id = :u AND balance >= :n
 * ```
 *
 * which is atomic on both engines, and whose *rows affected* is the answer.
 * `credit_ledger` is then the audit trail beside it — what was granted, what
 * was spent, on which day, and when — which is the question an operator
 * reconciling a card statement actually asks. `npm run credits -- audit`
 * compares the two and is how drift between them gets noticed.
 *
 * ## Why there is no row until there is
 *
 * A journal with no `credits` row has a balance of zero, which is what every
 * journal starts with by decision. The row is created by the first grant, and
 * `spend` on a missing row affects no rows and therefore refuses — the same
 * answer as a row holding zero, reached without a write. Nothing has to
 * back-fill a row per journal, and a journal created tomorrow needs no
 * special case.
 *
 * `owner_id` is the **username**, per the first convention in `lib/db/owner.ts`:
 * these rows belong to a person's journal and the tenant boundary is the
 * directory name. Getting that wrong would let one journal spend another's
 * credits.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("credits")
    // The username. Primary key rather than merely indexed: one balance per
    // journal is the invariant the conditional UPDATE above depends on, and a
    // second row for the same journal would silently halve the guard.
    // `notNull` as well as `primaryKey`, which looks redundant and is not:
    // SQLite permits NULL in a TEXT PRIMARY KEY (a documented quirk kept for
    // backwards compatibility), so without it this column is nullable on one
    // dialect and not the other. `test/db-migrations.test.ts` checks exactly
    // that across every table.
    .addColumn("owner_id", "text", (c) => c.primaryKey().notNull())
    .addColumn("balance", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("credit_ledger")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    // Signed: positive for a grant or a refund, negative for a spend. One
    // column rather than a `kind` plus an unsigned amount, so that the audit
    // is a `SUM()` and cannot be got wrong by forgetting a sign somewhere.
    .addColumn("delta", "integer", (c) => c.notNull())
    // "grant" | "day_mail" | "day_whatsapp" | "digest" | "refund". Plain text,
    // for the
    // reason `users.role` gives: the typed alternative needs `create type` on
    // Postgres, has no counterpart in SQLite, and a fourth channel is a
    // plausible future.
    .addColumn("reason", "text", (c) => c.notNull())
    // What it was spent on — `<username>/<trip-id>/<slug>` — or null for a
    // grant, which is about the account rather than about a day.
    .addColumn("ref", "text")
    // An operator's note on a grant ("invoice 2026-114"). Never shown to a
    // reader; this table has no reader-facing surface at all.
    .addColumn("note", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  // The only query this table answers on a request path is "this journal's
  // rows, newest first" — `npm run credits -- list`. Ordered by time within
  // the owner so that read needs no sort.
  await db.schema
    .createIndex("credit_ledger_owner")
    .on("credit_ledger")
    .columns(["owner_id", "created_at"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("credit_ledger_owner").execute();
  await db.schema.dropTable("credit_ledger").execute();
  await db.schema.dropTable("credits").execute();
}
