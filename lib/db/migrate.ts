import { Migrator, type MigrationResultSet } from "kysely/migration";
import type { DatabaseHandle } from "./client";
import { migrationProvider } from "./migrations";

/**
 * Bring a database up to the latest migration.
 *
 * The same call runs on both dialects, because the migrations themselves are
 * dialect-free. Kysely records what has run in `kysely_migration` and takes a
 * lock in `kysely_migration_lock`, so two servers starting at once is safe.
 */
export async function migrateToLatest(handle: DatabaseHandle): Promise<MigrationResultSet> {
  const migrator = new Migrator({ db: handle.db, provider: migrationProvider });
  const result = await migrator.migrateToLatest();
  if (result.error) throw asError(result.error, handle);
  return result;
}

/** Roll everything back. Only used by tests and by a self-hoster who wants
 * their data gone; there is no production path that calls this. */
export async function migrateDown(handle: DatabaseHandle): Promise<MigrationResultSet> {
  const migrator = new Migrator({ db: handle.db, provider: migrationProvider });
  const { NO_MIGRATIONS } = await import("kysely/migration");
  const result = await migrator.migrateTo(NO_MIGRATIONS);
  if (result.error) throw asError(result.error, handle);
  return result;
}

function asError(cause: unknown, handle: DatabaseHandle): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `Database migration failed on ${handle.target.label}: ${message}`,
    { cause },
  );
}
