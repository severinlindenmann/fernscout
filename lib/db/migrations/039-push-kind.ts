import type { MigrationDb } from "./types";

/**
 * Which transport a subscription sends through — B2115.
 *
 * `push_subscriptions` was Web Push only: `endpoint` a push service URL,
 * `p256dh`/`auth` a real encryption keypair. The iPhone shell has neither —
 * it registers a device token directly with Apple — so a row now carries
 * which shape it is. `"web"` for everything already here, since every row
 * before this migration is exactly that.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .alterTable("push_subscriptions")
    .addColumn("kind", "text", (c) => c.notNull().defaultTo("web"))
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("push_subscriptions").dropColumn("kind").execute();
}
