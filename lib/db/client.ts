import fs from "node:fs";
import path from "node:path";
import { Kysely, PostgresDialect, SqliteDialect, type Dialect } from "kysely";
import type { Database } from "./schema";
import type { DatabaseTarget } from "./url";

export type DialectName = DatabaseTarget["dialect"];

export type DatabaseHandle = {
  db: Kysely<Database>;
  /** Which engine this handle talks to. Read it in tests and in diagnostics —
   * application code must not branch on it. */
  dialect: DialectName;
  target: DatabaseTarget;
  destroy(): Promise<void>;
};

/**
 * The drivers are loaded with `await import` rather than a top-level import.
 *
 * Two reasons, both practical: a SQLite deployment never pays to load `pg`
 * (and vice versa), and — more importantly — an install that only has one of
 * the two available still starts, because the missing one is never reached.
 */
async function sqliteDialect(file: string): Promise<Dialect> {
  const { default: SqliteDatabase } = await import("better-sqlite3");

  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const database = new SqliteDatabase(file);
  // WAL lets a reader and the writer coexist, which matters the moment
  // `npm run notify` runs while the server is up. `foreign_keys` is off by
  // default in SQLite, so the schema's references would otherwise be
  // decoration on one dialect and enforced on the other.
  if (file !== ":memory:") database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  return new SqliteDialect({ database });
}

async function postgresDialect(connectionString: string): Promise<Dialect> {
  const { Pool } = await import("pg");
  return new PostgresDialect({
    pool: new Pool({ connectionString, max: 10 }),
  });
}

/** Open a connection to one target. The caller owns it and must `destroy()`
 * it; the shared, migrated instance lives in `lib/db/index.ts`. */
export async function createDatabase(target: DatabaseTarget): Promise<DatabaseHandle> {
  const dialect =
    target.dialect === "sqlite"
      ? await sqliteDialect(target.file)
      : await postgresDialect(target.connectionString);

  const db = new Kysely<Database>({ dialect });
  return {
    db,
    dialect: target.dialect,
    target,
    destroy: () => db.destroy(),
  };
}
