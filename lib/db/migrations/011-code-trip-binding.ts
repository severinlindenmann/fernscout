import type { MigrationDb } from "./types";

/**
 * The trip an agent code was issued for — B230.
 *
 * A one-time code was keyed on `(owner, email, kind)` and nothing else, so the
 * *width* of the token it produced was decided at redemption, from a `trip`
 * field the caller sent again. `/api/auth/request` had already refused an
 * agent code to anybody who is neither the owner nor on the trip they named;
 * that check was correct and was then thrown away, because the value it
 * checked was not written down. Omitting the field at verify time returned the
 * owner's unqualified `write:content` to somebody who was on one trip.
 *
 * This column is where the answer is kept. `issueCode` writes the trip that
 * was checked; `verifyCode` reads it off the row and mints
 * `write:trip:<trip_id>` from it, so there is no second value for a caller to
 * disagree with. A widening cannot be asked for, only a narrowing.
 *
 * Null for every row written before this migration, for every guest and signup
 * code — neither has a trip to be scoped to — and for an agent code the
 * journal's **owner** asked for without naming one, which is the only way an
 * unbound agent code is issued and is what still produces a journal-wide
 * token.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("login_codes").addColumn("trip_id", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("login_codes").dropColumn("trip_id").execute();
}
