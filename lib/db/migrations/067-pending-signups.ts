import type { MigrationDb } from "./types";

/**
 * A signup that stopped half-way — B2804.
 *
 * One row per address that proved itself at the signup door and has not yet
 * made a journal. It exists so a closed tab, an iOS tab dropped during the
 * WhatsApp switch, or a second device does not send the person back to
 * step one: the signup session lives 20 minutes and kept the phone proof
 * only on its own row. The email is the primary key (already normalised, one
 * pending signup per address). `phone`/`phone_proven_at`/`phone_proven_method`
 * are empty until a number is proven. Deleted when the journal is created;
 * swept at `email_proven_at` + 8 days by `scripts/signup-purge.mts`.
 *
 * Plain text timestamps and no foreign keys, like every table here, so the
 * same statements run on SQLite and Postgres.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("pending_signups")
    .addColumn("email", "text", (c) => c.primaryKey().notNull())
    .addColumn("email_proven_at", "text", (c) => c.notNull())
    .addColumn("locale", "text")
    .addColumn("phone", "text")
    .addColumn("phone_proven_at", "text")
    .addColumn("phone_proven_method", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  await db.schema.createIndex("pending_signups_proven").on("pending_signups").column("email_proven_at").execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropTable("pending_signups").execute();
}
