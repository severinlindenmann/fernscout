import type { MigrationDb } from "./types";

/**
 * Whether a push subscription belongs to the journal's own owner — B2447/
 * B2448 item 4's push branch needs to tell an owner's own device apart from
 * a reader's anonymous subscription to the same journal, which it could not
 * before this column existed (`StoredSubscription` only ever tied a row to a
 * *reader* contact). Decided once, at subscribe time
 * (`app/api/push/subscribe/route.ts`), from the same owner-cookie check
 * every other owner-only door uses (`isOwner`, lib/contacts/session.ts) —
 * never from anything the client's own request body claims. 0/1 — the
 * schema has no boolean (see lib/db/schema.ts's own note).
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .alterTable("push_subscriptions")
    .addColumn("is_owner", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("push_subscriptions").dropColumn("is_owner").execute();
}
