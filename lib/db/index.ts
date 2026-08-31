import { createDatabase, type DatabaseHandle } from "./client";
import { migrateToLatest } from "./migrate";
import { databaseTarget, type DatabaseTarget } from "./url";

export type { DatabaseHandle, DialectName } from "./client";
export type { DatabaseTarget } from "./url";
export type { Database } from "./schema";
export { DatabaseUrlError, parseDatabaseUrl, databaseTarget } from "./url";
export { createDatabase } from "./client";
export { migrateToLatest, migrateDown } from "./migrate";
export { TABLE_NAMES } from "./schema";
export { DEFAULT_OWNER_ID, currentOwnerId, newId, nowIso } from "./owner";

/**
 * Is there a database at all?
 *
 * "No" is a supported answer. The public site is markdown on disk, and the
 * prototype in ROADMAP §2.2 runs with no Postgres anywhere; every repository
 * in `lib/repos` has a file-backed sibling for exactly this case. Anything
 * that genuinely cannot work without storage is gated by the capability
 * registry (`lib/capabilities.ts`) instead of failing at request time.
 */
export function isDatabaseConfigured(): boolean {
  try {
    return databaseTarget() !== null;
  } catch {
    // A malformed DATABASE_URL is a misconfiguration, not an absence — but
    // this predicate is asked on the request path, so it answers "no" and
    // lets `assertDatabaseUrl()` at boot be the thing that shouts.
    return false;
  }
}

/** Throw at boot if `DATABASE_URL` is set to something unparseable, rather
 * than quietly running as if no database had been configured. */
export function assertDatabaseUrl(): void {
  databaseTarget();
}

/**
 * The shared, migrated connection.
 *
 * Cached on `globalThis` rather than in a module-scoped variable because the
 * Next dev server re-evaluates modules on every edit, and a fresh SQLite
 * handle per hot reload leaks file descriptors until the process dies.
 */
type Cache = { handle: Promise<DatabaseHandle> | null; target: string | null };

const globalCache = globalThis as typeof globalThis & {
  __fernscoutDb?: Cache;
};

function cache(): Cache {
  globalCache.__fernscoutDb ??= { handle: null, target: null };
  return globalCache.__fernscoutDb;
}

function keyOf(target: DatabaseTarget): string {
  return target.dialect === "sqlite" ? `sqlite:${target.file}` : target.connectionString;
}

async function open(target: DatabaseTarget): Promise<DatabaseHandle> {
  const handle = await createDatabase(target);
  try {
    await migrateToLatest(handle);
  } catch (err) {
    await handle.destroy();
    throw err;
  }
  return handle;
}

/**
 * The database, migrated and ready. Throws when none is configured — call
 * `getDatabaseOrNull()` if "there might not be one" is a real possibility,
 * which above `lib/repos` it usually is.
 */
export async function getDatabase(): Promise<DatabaseHandle> {
  const target = databaseTarget();
  if (!target) {
    throw new Error(
      "No database is configured. Set DATABASE_URL (sqlite: for local development) " +
        "or use a file-backed repository.",
    );
  }

  const c = cache();
  const key = keyOf(target);
  if (c.handle && c.target === key) return c.handle;
  if (c.handle) {
    // DATABASE_URL changed under us — only really possible in tests, but a
    // stale handle pointed at the previous file is a nasty way to find out.
    const stale = c.handle;
    c.handle = null;
    void stale.then((h) => h.destroy()).catch(() => undefined);
  }

  const opening = open(target);
  c.handle = opening;
  c.target = key;
  // A failed open must not be cached, or the process never recovers from a
  // database that was merely late to start.
  opening.catch(() => {
    if (c.handle === opening) {
      c.handle = null;
      c.target = null;
    }
  });
  return opening;
}

export async function getDatabaseOrNull(): Promise<DatabaseHandle | null> {
  if (!isDatabaseConfigured()) return null;
  return getDatabase();
}

/** Close the shared connection. For tests and for a clean shutdown. */
export async function closeDatabase(): Promise<void> {
  const c = cache();
  const handle = c.handle;
  c.handle = null;
  c.target = null;
  if (handle) await handle.then((h) => h.destroy()).catch(() => undefined);
}
