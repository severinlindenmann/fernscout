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
 * The skip is deliberate, but "a variable is unset" is not a thing anybody can
 * act on, so `POSTGRES_HOWTO` below is the command that would make it run. It
 * lives here, once, because it is quoted from three test files (B181).
 */
export type DialectCase = { name: string; target: DatabaseTarget };

/** The container the CI workflow starts, written as the two commands a person
 * would run on their own machine. Kept in step with `.github/workflows/ci.yml`
 * — same image, same credentials, same database name — so that a developer
 * reproducing a CI failure is talking to the same Postgres CI was. */
export const POSTGRES_HOWTO = [
  "  docker run --rm -d --name fernscout-pg -p 5432:5432 \\",
  "    -e POSTGRES_USER=fernscout -e POSTGRES_PASSWORD=fernscout \\",
  "    -e POSTGRES_DB=fernscout_test postgres:17-alpine",
  "  POSTGRES_TEST_URL=postgres://fernscout:fernscout@localhost:5432/fernscout_test npx vitest run",
].join("\n");

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
