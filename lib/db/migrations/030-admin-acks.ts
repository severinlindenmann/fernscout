import type { MigrationDb } from "./types";

/**
 * What the operator has said they already know about — B1203.
 *
 * B1181's attention band is the only red on `/admin` and it had no answer to
 * it. An entry that is a *decision* rather than a job — an off-site backup
 * destination this instance deliberately does not have — sat above the money
 * on every load, for ever. The cost of an alarm nobody can answer is that they
 * stop reading the band, which is the whole thing the band was for; B1085
 * stopped the nightly success mail for the same reason from the other side.
 *
 * ## An acknowledgement lives exactly as long as the thing it acknowledges
 *
 * That sentence is the whole schema, and it is what keeps this from being a
 * muzzle. "Never show me this again" against a live measurement would mean a
 * backup acknowledged at nine days stale staying silent at ninety — and this
 * deployment has already spent two days believing silence was health (B138,
 * and B458 which added the success mail because of it).
 *
 * So two columns carry the whole rule:
 *
 * - **`level`** is how bad it was at the moment it was acknowledged, in
 *   whatever unit that entry counts in — days stale, percent full, journals
 *   under the floor. The suppression holds while the entry is no worse than
 *   this and lapses the moment it is worse. Acknowledging is therefore "I know
 *   about this, at this size", never "I do not want to hear from you".
 * - **`ended_at`** is set when the entry stops appearing at all, by
 *   `sweepAcks`. A fault that is fixed loses its acknowledgement, so the same
 *   fault happening again is news rather than something already answered — and
 *   nobody has to remember to un-hide anything.
 *
 * ## One table, because the history is the same rows
 *
 * A row with no `ended_at` is a live suppression; every row, ended or not, is
 * the history the page shows under the band. A second table for "what was
 * acknowledged once" would hold the same facts and would be the copy that
 * disagrees.
 *
 * **One row per press, not one per entry.** The obvious schema keys on the
 * entry and updates it in place, and that schema has no history in it at all:
 * a backup acknowledged in June, fixed in July and acknowledged again in
 * August is one row saying August. *How long have I been living with this* is
 * exactly the question the history is opened for, so `id` is the press and
 * `entry_id` is what was pressed. At most one row per `entry_id` is live at a
 * time, which `endAck` maintains rather than a unique index — two live rows
 * would be a bug to fix, not a refusal anybody could act on, and a constraint
 * that threw here would take the whole console down with it.
 *
 * ## `entry_id` is not the title
 *
 * The titles carry numbers that move — *"The off-site copy has not arrived in
 * 226 hours"* is a different string every hour. `entry_id` is the stable
 * identity the entry computes for itself (`backup:secondary`,
 * `disk:<journal>`), which is why `Attend` and `Wrong` both had to grow one.
 *
 * Instance state and not a journal's, so there is no `owner_id` and nothing
 * here goes when a journal does. `acked_by` is the operator's address, kept
 * for the record rather than read as a permission: `FERNSCOUT_ADMIN_EMAIL` is
 * one address, and `isInstanceAdmin` is what decides.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("admin_acks")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    // Always `NO_JOURNAL` — the `"*"` sentinel `lib/auth/index.ts` already
    // uses for a row that is about the instance and about no journal, and
    // which `USERNAME_RE` can never collide with. Every table carries this
    // column (ROADMAP §0.5) and `lib/deletions.ts` sweeps every table by it,
    // so the column is not optional; what is deliberate is the value. An
    // acknowledgement is the operator's, not a journal's, and deleting a
    // journal must not silently take one with it — a `disk:<journal>` row for
    // a journal that has gone stops holding at the next sweep anyway, because
    // nothing raises it any more.
    // No default, deliberately: every row this codebase writes puts
    // `NO_JOURNAL` here on purpose and in one place, and a default would let a
    // future writer leave it out without deciding anything.
    .addColumn("owner_id", "text", (c) => c.notNull())
    // What was acknowledged — the band entry's own stable id.
    .addColumn("entry_id", "text", (c) => c.notNull())
    // How bad it was when it was acknowledged, in that entry's own unit. Not
    // comparable across ids and never meant to be.
    .addColumn("level", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("acked_at", "text", (c) => c.notNull())
    .addColumn("acked_by", "text", (c) => c.notNull().defaultTo(""))
    // Null while the acknowledgement is holding. Set when the entry stopped
    // appearing ("fixed") or when the operator brought it back ("unhidden").
    .addColumn("ended_at", "text")
    .addColumn("ended_why", "text", (c) => c.notNull().defaultTo(""))
    .execute();

  // The two reads: what is holding right now, and the history newest first.
  await db.schema
    .createIndex("admin_acks_live")
    .on("admin_acks")
    .columns(["entry_id", "ended_at"])
    .execute();
  await db.schema
    .createIndex("admin_acks_acked")
    .on("admin_acks")
    .columns(["acked_at"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("admin_acks_acked").execute();
  await db.schema.dropIndex("admin_acks_live").execute();
  await db.schema.dropTable("admin_acks").execute();
}
