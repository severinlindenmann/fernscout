import { sql } from "kysely";
import {
  TABLE_NAMES,
  createDatabase,
  migrateDown,
  migrateToLatest,
  parseDatabaseUrl,
  type DatabaseHandle,
  type DatabaseTarget,
} from "@/lib/db";

/**
 * The both-dialects harness.
 *
 * SQLite always runs — `better-sqlite3` needs no server, which is the whole
 * premise of W06. Postgres runs when `POSTGRES_TEST_URL` points at a database
 * the suite may **wipe**, and is skipped, loudly but without failing, when it
 * doesn't. That keeps `npx vitest run` green on a laptop with no Postgres and
 * still lets CI prove the migrations are portable.
 *
 *   POSTGRES_TEST_URL=postgres://localhost:5432/fernscout_test npx vitest run
 */
export type DialectCase = { name: string; target: DatabaseTarget };

export function dialectCases(): DialectCase[] {
  const cases: DialectCase[] = [
    { name: "sqlite", target: parseDatabaseUrl("sqlite::memory:")! },
  ];
  const url = process.env.POSTGRES_TEST_URL;
  if (url && url.trim() !== "") {
    cases.push({ name: "postgres", target: parseDatabaseUrl(url)! });
  }
  return cases;
}

export function postgresConfigured(): boolean {
  return dialectCases().some((c) => c.name === "postgres");
}

/** Every trace of the schema, gone. Postgres test databases are reused across
 * runs, so a leftover table from a failed run would otherwise be indisting-
 * uishable from a migration that worked. */
export async function dropEverything(handle: DatabaseHandle): Promise<void> {
  await migrateDown(handle);
  await handle.db.schema.dropTable("kysely_migration").ifExists().execute();
  await handle.db.schema.dropTable("kysely_migration_lock").ifExists().execute();
}

/** An empty, fully migrated database. The caller must `destroy()` it. */
export async function freshDatabase(target: DatabaseTarget): Promise<DatabaseHandle> {
  const handle = await createDatabase(target);
  await dropEverything(handle);
  await migrateToLatest(handle);
  return handle;
}

/** Empty every table without touching the schema — child tables first, so the
 * foreign keys SQLite now enforces don't object. */
export async function clearTables(handle: DatabaseHandle): Promise<void> {
  for (const table of [...TABLE_NAMES].reverse()) {
    await sql`delete from ${sql.table(table)}`.execute(handle.db);
  }
}
