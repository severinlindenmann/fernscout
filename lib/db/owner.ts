/**
 * Who owns a row.
 *
 * ## Two conventions live in this schema, and both are correct
 *
 * Tables whose rows belong to a *person* — `contacts`, `push_subscriptions`,
 * `sessions`, `login_codes` — set `owner_id` to the **username**. That is the
 * tenant boundary, and getting it wrong leaks across journals: push
 * subscriptions were briefly stored under the constant below, which meant one
 * journal's notify run would have fanned out to every other journal's readers
 * on a shared deployment.
 *
 * `reactions` is different, and deliberately so: its rows are keyed by a
 * **qualified trip ref** (`<username>/<trip-id>`), so the trip column already
 * carries the owner and the `owner_id` column adds nothing. `test/reactions`
 * asserts that property rather than leaving it incidental — if a bare trip id
 * ever reaches the repository, two journals could collide on a slug.
 *
 * This constant therefore means "not scoped by owner_id, scoped by the ref",
 * not "single tenant". New tables should use the username.
 */
export const DEFAULT_OWNER_ID = "owner";

export function currentOwnerId(): string {
  return DEFAULT_OWNER_ID;
}

/** Row ids are generated here, not by the database: `serial` is not portable
 * across the two dialects and an id that exists before the insert makes
 * upserts and importers much simpler to write. */
export function newId(): string {
  return crypto.randomUUID();
}

/** The one timestamp format this schema uses — ISO-8601, UTC, string-sortable.
 * See the note in `lib/db/schema.ts`. */
export function nowIso(): string {
  return new Date().toISOString();
}
