import type { Kysely } from "kysely";

/**
 * The handle a migration gets.
 *
 * Deliberately untyped: a migration runs against the schema as it was when
 * the migration was written, not the schema in `lib/db/schema.ts`. Typing it
 * with the current `Database` would make old migrations start failing to
 * compile the day a column is renamed, which is exactly backwards.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MigrationDb = Kysely<any>;
