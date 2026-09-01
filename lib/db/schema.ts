/**
 * The one typed schema, shared by both dialects.
 *
 * ## Why the column types look old-fashioned
 *
 * Everything here has to mean the same thing in SQLite and in Postgres, and
 * the two disagree about more than you'd hope. The rules, applied without
 * exception:
 *
 * - **Ids are `text`, generated in application code.** No `serial`, no
 *   `autoincrement` — SQLite's `INTEGER PRIMARY KEY` and Postgres' `serial`
 *   are different mechanisms with different reserved names, and neither
 *   survives a dump/restore across engines.
 * - **Timestamps are `text`, ISO-8601 in UTC.** SQLite has no date type at
 *   all; `pg` hands back `Date` objects for `timestamptz`. Storing text means
 *   a row read on either dialect is the same JavaScript value, which is the
 *   whole point of this file. ISO-8601 UTC also sorts correctly as a string.
 * - **Booleans are `integer` 0/1.** SQLite has no boolean, and `pg` returns
 *   real booleans, so a shared `boolean` column would read back differently
 *   per dialect. The repository layer converts at the edge.
 * - **JSON is `text`.** No `jsonb`, no arrays. Callers parse.
 * - **Floats are `double precision`.** Standard SQL; SQLite gives it REAL
 *   affinity, and `pg` parses float8 into a plain number. `numeric` would come
 *   back from `pg` as a string.
 *
 * ## Why every table has `owner_id`
 *
 * ROADMAP §0.5: there is one user today and adding a tenant column later is
 * the expensive kind of migration. It costs nothing now. `owner_id` is a
 * plain column and not a foreign key to `users` — the owner is a tenant
 * handle that exists before anybody has signed in, and the importer writes
 * owned rows into a database with no user rows in it at all.
 */

import type { Generated } from "kysely";

export type UsersTable = {
  id: string;
  owner_id: string;
  email: string;
  name: string | null;
  /** `owner` | `editor` | `reader`. Text rather than an enum: Postgres enums
   * need `create type`, SQLite has none, and W08 will want to add values. */
  role: Generated<string>;
  locale: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export type SessionsTable = {
  id: string;
  owner_id: string;
  user_id: string;
  /** "guest" (read, long-lived) or "agent" (write, seven days) — decision 24.
   * Checked at every use, so the two are never interchangeable. */
  kind: string;
  /** A hash of the session token, never the token itself. */
  token_hash: string | null;
  scope: string | null;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  user_agent: string | null;
  ip: string | null;
};

export type LoginCodesTable = {
  id: string;
  owner_id: string;
  email: string;
  /** sha-256 of the six-digit code. The code exists only in the email. */
  code_hash: string;
  /** sha-256 of the one-click sign-in link's token. Null for agent codes,
   * which have no link. See `005-signin-link` for why the two credentials are
   * consumed separately. */
  link_hash: string | null;
  kind: string;
  created_at: string;
  expires_at: string;
  /** Set when the *code* is redeemed, which retires the link with it. */
  consumed_at: string | null;
  /** Set when the *link* is redeemed. Leaves the code usable, so a mail
   * scanner that follows the link cannot lock the reader out. */
  link_consumed_at: string | null;
  attempts: number;
};

export type ContactsTable = {
  id: string;
  owner_id: string;
  /** May hold ciphertext once W10 turns on `CONTACTS_ENCRYPTION_KEY`. */
  email: string;
  /** Stable, case-folded lookup key for `email`. Separate from `email` so
   * encrypting the address later does not break uniqueness or lookup. */
  email_key: string;
  name: string | null;
  /** The one language this person is written to in — ROADMAP §3.1 calls it
   * `preferred_locale`. It is the same column: the digest, the postcard and
   * every landing page read it, so a second "preferred" column beside this
   * one would only be a way for the two to disagree. */
  locale: string | null;
  /** `pending` | `active` | `blocked`. */
  status: Generated<string>;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** AES-256-GCM ciphertext of the postal address, or null when they did not
   * want a postcard. Never readable without `CONTACTS_ENCRYPTION_KEY`; see
   * `lib/contacts/crypto.ts`. */
  postal_cipher: string | null;
  /** 0/1 — the schema has no boolean. Two consents, asked separately. */
  wants_email_digest: Generated<number>;
  wants_postcard: Generated<number>;
  /** `invite:<id>` | `open` | `owner` — which link brought them here. */
  created_via: string | null;
  /** When the address was proved with a one-time code (double opt-in). */
  confirmed_at: string | null;
  /** When the owner approved them. Confirming is not being approved. */
  approved_at: string | null;
  last_seen_at: string | null;
  /** sha-256 of the self-serve edit/unsubscribe token in the mail footer. */
  manage_token_hash: string | null;
};

/**
 * A personal invitation link — decision 19.
 *
 * It holds a name and a language and no email, because it is an invitation to
 * *request*, not a grant. Forwarding it can therefore only ever prefill a form
 * for whoever opens it; identity still comes from confirming an address.
 */
export type ContactInvitesTable = {
  id: string;
  owner_id: string;
  /** `personal`. The only kind: the open link that had no row at all, because
   * it carried no secret, was removed in B37. */
  kind: Generated<string>;
  token_hash: string;
  name: string | null;
  locale: string | null;
  trip_id: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  uses: Generated<number>;
};

export type AccessGrantsTable = {
  id: string;
  owner_id: string;
  contact_id: string;
  /** A trip id, or `*` for every trip. */
  trip_id: string;
  /** `read` | `costs` | … — what the grant unlocks. */
  scope: Generated<string>;
  granted_at: string;
  granted_by: string | null;
  expires_at: string | null;
};

/**
 * One digest, as it was sent to one reader — see `004-digest`.
 *
 * `cursor` is the high-water mark (the newest day date the mail covered), and
 * it is what makes a second run a no-op instead of a duplicate. `status` is
 * `sending` | `sent` | `failed`; a row left at `sending` is an attempt whose
 * outcome nobody knows, and counts as delivered.
 */
export type DigestSendsTable = {
  id: string;
  owner_id: string;
  contact_id: string;
  status: Generated<string>;
  /** `YYYY-MM-DD` — the newest day reported to this reader. */
  cursor: string;
  day_count: Generated<number>;
  /** JSON, as text: what went out, for the human reading this later. */
  trips: Generated<string>;
  locale: string | null;
  mail_ref: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
};

export type PushSubscriptionsTable = {
  id: string;
  owner_id: string;
  /** Null until W12 ties a browser to a known reader. */
  contact_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
};

export type ReactionsTable = {
  id: string;
  owner_id: string;
  trip_id: string;
  day_slug: string;
  /** A random string the browser made up. Nothing here identifies a person. */
  voter_id: string;
  emoji: string;
  created_at: string;
  updated_at: string;
};

export type JobsTable = {
  id: string;
  owner_id: string;
  /** `digest` | `push` | `print` | … */
  kind: string;
  /** JSON, as text. */
  payload: Generated<string>;
  /** `pending` | `running` | `done` | `failed`. */
  status: Generated<string>;
  attempts: Generated<number>;
  run_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type TrackingPointsTable = {
  id: string;
  owner_id: string;
  trip_id: string | null;
  device_id: string | null;
  recorded_at: string;
  lat: number;
  lon: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  battery: number | null;
  /** The provider's original payload, as JSON text, so a parser bug is
   * recoverable without asking the phone to send it again. */
  raw: string | null;
  created_at: string;
};

export type PrintOrdersTable = {
  id: string;
  owner_id: string;
  /** `postcard` | `photobook`. */
  kind: string;
  /** `dry-run` | `stannp` | `peecho` | … */
  provider: string;
  provider_ref: string | null;
  contact_id: string | null;
  trip_id: string | null;
  /** `draft` | `submitted` | `printed` | `failed`. */
  status: Generated<string>;
  /** JSON, as text. */
  payload: Generated<string>;
  /** Minor units, so no floating point money. */
  cost_minor: number | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  users: UsersTable;
  sessions: SessionsTable;
  login_codes: LoginCodesTable;
  contacts: ContactsTable;
  contact_invites: ContactInvitesTable;
  access_grants: AccessGrantsTable;
  digest_sends: DigestSendsTable;
  push_subscriptions: PushSubscriptionsTable;
  reactions: ReactionsTable;
  jobs: JobsTable;
  tracking_points: TrackingPointsTable;
  print_orders: PrintOrdersTable;
};

/** Every table this schema owns, in dependency order. Used by tests and by
 * the truncate helper; keeping it next to the type stops the two drifting. */
export const TABLE_NAMES = [
  "users",
  "sessions",
  "login_codes",
  "contacts",
  "contact_invites",
  "access_grants",
  "digest_sends",
  "push_subscriptions",
  "reactions",
  "jobs",
  "tracking_points",
  "print_orders",
] as const satisfies readonly (keyof Database)[];
