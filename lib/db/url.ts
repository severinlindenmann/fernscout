import path from "node:path";
import { dataDir } from "../dataDir";

/**
 * Which database, and where.
 *
 * This is the *only* place a dialect name is derived from configuration.
 * Everything above `lib/db` asks the repository layer for data and never
 * learns which of these two it got.
 */
export type DatabaseTarget =
  | { dialect: "sqlite"; file: string; label: string }
  | { dialect: "postgres"; connectionString: string; label: string };

export class DatabaseUrlError extends Error {
  constructor(message: string) {
    super(
      `${message}\n` +
        `Supported forms:\n` +
        `  DATABASE_URL=sqlite:                     (file at $DATA_DIR/fernscout.db)\n` +
        `  DATABASE_URL=sqlite:./.data/fernscout.db\n` +
        `  DATABASE_URL=sqlite::memory:             (tests)\n` +
        `  DATABASE_URL=postgres://user:pw@host:5432/db\n` +
        `Leave DATABASE_URL unset to run with no database at all.`,
    );
    this.name = "DatabaseUrlError";
  }
}

/** The SQLite file used when the URL names a dialect but not a path. */
export function defaultSqliteFile(): string {
  return path.join(dataDir(), "fernscout.db");
}

/** `postgres://ana:hunter2@db/fernscout` → `postgres://ana:***@db/fernscout`.
 * Connection strings end up in boot logs and error messages; passwords should
 * not follow them there. */
function redact(connectionString: string): string {
  return connectionString.replace(/(:\/\/[^:/@]*:)[^@]*@/, "$1***@");
}

function sqliteTarget(rest: string): DatabaseTarget {
  // `sqlite::memory:` is the one path that is not a path.
  if (rest === ":memory:" || rest === "//:memory:") {
    return { dialect: "sqlite", file: ":memory:", label: "sqlite (in memory)" };
  }
  // `sqlite:///abs/path` and `sqlite://./rel` are both in the wild; the
  // authority section is always empty for a file, so drop it either way.
  const withoutSlashes = rest.startsWith("//") ? rest.slice(2) : rest;
  // The ignore comment is for Turbopack: a `process.cwd()` join looks to its
  // static analysis like the server needs the whole project traced into the
  // output. It doesn't — this resolves a path for `better-sqlite3` to open at
  // runtime and reads nothing at build time.
  const file =
    withoutSlashes.trim() === ""
      ? defaultSqliteFile()
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), withoutSlashes);
  return { dialect: "sqlite", file, label: `sqlite (${file})` };
}

/**
 * Parse `DATABASE_URL`. Returns `null` when there is no database configured,
 * which is a supported way to run: the public site is markdown on disk and
 * needs nothing else (ROADMAP §2.2).
 */
export function parseDatabaseUrl(raw: string | undefined): DatabaseTarget | null {
  const url = (raw ?? "").trim();
  if (url === "") return null;

  const scheme = url.slice(0, url.indexOf(":") + 1).toLowerCase();
  const rest = url.slice(scheme.length);

  switch (scheme) {
    case "sqlite:":
    case "file:":
      return sqliteTarget(rest);
    case "postgres:":
    case "postgresql:":
      if (rest.replace(/^\/+/, "").trim() === "") {
        throw new DatabaseUrlError(`DATABASE_URL "${url}" names no Postgres host.`);
      }
      return {
        dialect: "postgres",
        connectionString: url,
        label: `postgres (${redact(url)})`,
      };
    case "":
      throw new DatabaseUrlError(`DATABASE_URL "${url}" has no scheme.`);
    default:
      throw new DatabaseUrlError(
        `DATABASE_URL scheme "${scheme.replace(/:$/, "")}" is not supported.`,
      );
  }
}

/** The configured target, or `null`. Throws on a malformed URL rather than
 * silently falling back to "no database" — a typo in production should be
 * loud, not quietly featureless. */
export function databaseTarget(): DatabaseTarget | null {
  return parseDatabaseUrl(process.env.DATABASE_URL);
}
