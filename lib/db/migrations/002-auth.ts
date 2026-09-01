import type { MigrationDb } from "./types";

/**
 * One-time codes, and the two classes of session they produce.
 *
 * Decision 24 splits authentication in two: a short-lived **agent** token that
 * can write, and a long-lived **guest** session that can only read. They are
 * deliberately not interchangeable, so the class is stored on the session and
 * checked at every use rather than inferred from how long it lasts.
 *
 * Nothing here stores a secret in the clear. A login code and a session token
 * are both bearer credentials: the database keeps only their hashes, so a
 * database dump does not become a set of working logins.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("login_codes")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.notNull())
    // sha-256 of the code. The code itself only ever exists in the email.
    .addColumn("code_hash", "text", (c) => c.notNull())
    // "guest" or "agent" — a code issued for reading cannot be redeemed for
    // a token that writes.
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("expires_at", "text", (c) => c.notNull())
    .addColumn("consumed_at", "text")
    // Counted so a code can be burned after a handful of wrong guesses,
    // rather than staying live for the rest of its window.
    .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex("login_codes_lookup")
    .on("login_codes")
    .columns(["owner_id", "email", "kind"])
    .execute();

  await db.schema
    .createIndex("login_codes_expiry")
    .on("login_codes")
    .columns(["expires_at"])
    .execute();

  // Sessions gain a class, a scope and a hashed token.
  await db.schema
    .alterTable("sessions")
    .addColumn("kind", "text", (c) => c.notNull().defaultTo("guest"))
    .execute();

  await db.schema
    .alterTable("sessions")
    .addColumn("token_hash", "text")
    .execute();

  await db.schema.alterTable("sessions").addColumn("scope", "text").execute();

  await db.schema.alterTable("sessions").addColumn("revoked_at", "text").execute();

  await db.schema
    .createIndex("sessions_token")
    .on("sessions")
    .columns(["token_hash"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("sessions_token").execute();
  await db.schema.alterTable("sessions").dropColumn("revoked_at").execute();
  await db.schema.alterTable("sessions").dropColumn("scope").execute();
  await db.schema.alterTable("sessions").dropColumn("token_hash").execute();
  await db.schema.alterTable("sessions").dropColumn("kind").execute();
  await db.schema.dropIndex("login_codes_expiry").execute();
  await db.schema.dropIndex("login_codes_lookup").execute();
  await db.schema.dropTable("login_codes").execute();
}
