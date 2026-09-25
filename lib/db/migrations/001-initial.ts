import type { MigrationDb } from "./types";

/**
 * The initial schema.
 *
 * Runs unchanged on SQLite and on Postgres — see the type rules at the top of
 * `lib/db/schema.ts`. If you add a migration and it needs a dialect check, the
 * migration is wrong.
 *
 * `owner_id` on every table is ROADMAP §0.5 and is not negotiable, one user or
 * not: retrofitting a tenant column onto live data is the expensive migration
 * this project is trying never to have to write.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("name", "text")
    .addColumn("role", "text", (c) => c.notNull().defaultTo("reader"))
    .addColumn("locale", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addColumn("last_login_at", "text")
    .execute();

  await db.schema
    .createIndex("users_owner_email_unique")
    .on("users")
    .columns(["owner_id", "email"])
    .unique()
    .execute();

  await db.schema
    .createTable("sessions")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("expires_at", "text", (c) => c.notNull())
    .addColumn("last_seen_at", "text")
    .addColumn("user_agent", "text")
    .addColumn("ip", "text")
    .execute();

  await db.schema
    .createIndex("sessions_user")
    .on("sessions")
    .columns(["owner_id", "user_id"])
    .execute();

  await db.schema
    .createIndex("sessions_expiry")
    .on("sessions")
    .columns(["expires_at"])
    .execute();

  await db.schema
    .createTable("contacts")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("email_key", "text", (c) => c.notNull())
    .addColumn("name", "text")
    .addColumn("locale", "text")
    .addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
    .addColumn("notes", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("contacts_owner_email_key_unique")
    .on("contacts")
    .columns(["owner_id", "email_key"])
    .unique()
    .execute();

  await db.schema
    .createTable("access_grants")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("contact_id", "text", (c) =>
      c.notNull().references("contacts.id").onDelete("cascade"),
    )
    .addColumn("trip_id", "text", (c) => c.notNull())
    .addColumn("scope", "text", (c) => c.notNull().defaultTo("read"))
    .addColumn("granted_at", "text", (c) => c.notNull())
    .addColumn("granted_by", "text")
    .addColumn("expires_at", "text")
    .execute();

  await db.schema
    .createIndex("access_grants_unique")
    .on("access_grants")
    .columns(["owner_id", "contact_id", "trip_id", "scope"])
    .unique()
    .execute();

  await db.schema
    .createTable("push_subscriptions")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("contact_id", "text", (c) =>
      c.references("contacts.id").onDelete("set null"),
    )
    .addColumn("endpoint", "text", (c) => c.notNull())
    .addColumn("p256dh", "text", (c) => c.notNull())
    .addColumn("auth", "text", (c) => c.notNull())
    .addColumn("user_agent", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("last_seen_at", "text")
    .execute();

  // Browsers re-subscribe the same endpoint routinely; the unique index is
  // what turns that into an update instead of a duplicate.
  await db.schema
    .createIndex("push_subscriptions_endpoint_unique")
    .on("push_subscriptions")
    .columns(["owner_id", "endpoint"])
    .unique()
    .execute();

  await db.schema
    .createTable("reactions")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("trip_id", "text", (c) => c.notNull())
    .addColumn("day_slug", "text", (c) => c.notNull())
    .addColumn("voter_id", "text", (c) => c.notNull())
    .addColumn("emoji", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  // One vote per reader per day. Storing the votes rather than a counter is
  // what makes the counts un-driftable, and this index is what makes changing
  // your mind an upsert.
  await db.schema
    .createIndex("reactions_vote_unique")
    .on("reactions")
    .columns(["owner_id", "trip_id", "day_slug", "voter_id"])
    .unique()
    .execute();

  await db.schema
    .createIndex("reactions_trip")
    .on("reactions")
    .columns(["owner_id", "trip_id"])
    .execute();

  await db.schema
    .createTable("jobs")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("payload", "text", (c) => c.notNull().defaultTo("{}"))
    .addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
    .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("run_at", "text", (c) => c.notNull())
    .addColumn("locked_at", "text")
    .addColumn("locked_by", "text")
    .addColumn("last_error", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("jobs_queue")
    .on("jobs")
    .columns(["status", "run_at"])
    .execute();

  await db.schema
    .createTable("tracking_points")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("trip_id", "text")
    .addColumn("device_id", "text")
    .addColumn("recorded_at", "text", (c) => c.notNull())
    .addColumn("lat", "double precision", (c) => c.notNull())
    .addColumn("lon", "double precision", (c) => c.notNull())
    .addColumn("altitude", "double precision")
    .addColumn("accuracy", "double precision")
    .addColumn("speed", "double precision")
    .addColumn("battery", "integer")
    .addColumn("raw", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("tracking_points_track")
    .on("tracking_points")
    .columns(["owner_id", "trip_id", "recorded_at"])
    .execute();

  // A device that retries an upload must not double the track.
  await db.schema
    .createIndex("tracking_points_dedupe")
    .on("tracking_points")
    .columns(["owner_id", "device_id", "recorded_at"])
    .unique()
    .execute();

  await db.schema
    .createTable("print_orders")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("provider", "text", (c) => c.notNull())
    .addColumn("provider_ref", "text")
    .addColumn("contact_id", "text", (c) =>
      c.references("contacts.id").onDelete("set null"),
    )
    .addColumn("trip_id", "text")
    .addColumn("status", "text", (c) => c.notNull().defaultTo("draft"))
    .addColumn("payload", "text", (c) => c.notNull().defaultTo("{}"))
    .addColumn("cost_minor", "integer")
    .addColumn("currency", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("print_orders_status")
    .on("print_orders")
    .columns(["owner_id", "status"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  for (const table of [
    "print_orders",
    "tracking_points",
    "jobs",
    "reactions",
    "push_subscriptions",
    "access_grants",
    "contacts",
    "sessions",
    "users",
  ]) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
