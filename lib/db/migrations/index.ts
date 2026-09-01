import type { Migration, MigrationProvider } from "kysely/migration";
import * as initial from "./001-initial";
import * as auth from "./002-auth";
import * as contacts from "./003-contacts";
import * as digest from "./004-digest";
import * as signinLink from "./005-signin-link";
import * as standingLink from "./006-standing-link";

/**
 * Every migration, listed by hand.
 *
 * Kysely ships a `FileMigrationProvider` that reads a directory at runtime.
 * We don't use it: this code runs inside a bundled Next.js server where the
 * migration files are no longer separate files on disk. A static map is also
 * the version that a `grep` can answer questions about.
 *
 * Names are ordered lexicographically by Kysely, so the numeric prefix is
 * load-bearing. Never rename or renumber one that has run anywhere — the name
 * is the primary key in `kysely_migration`.
 */
export const MIGRATIONS: Record<string, Migration> = {
  "001-initial": initial,
  "002-auth": auth,
  "003-contacts": contacts,
  "004-digest": digest,
  "005-signin-link": signinLink,
  "006-standing-link": standingLink,
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return MIGRATIONS;
  },
};
