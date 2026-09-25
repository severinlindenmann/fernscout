import type { MigrationDb } from "./types";

/**
 * B1065 — where a `signup` session remembers the number it proved.
 *
 * `phone` and `phone_proven_at` are set together, once, by
 * `POST /api/auth/signup/phone/verify` on success, and read once, by
 * `POST /api/v1/journals`, to decide what to write into the new journal's
 * `owner.tel`. Null on every other session kind.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("sessions").addColumn("phone", "text").execute();
  await db.schema.alterTable("sessions").addColumn("phone_proven_at", "text").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("sessions").dropColumn("phone_proven_at").execute();
  await db.schema.alterTable("sessions").dropColumn("phone").execute();
}
