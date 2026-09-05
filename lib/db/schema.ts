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
  /**
   * Where redeeming the *link* should land — the page the reader was on when
   * they asked for the code. A path, never a URL, and always inside
   * `/<owner_id>/`; null when there is nowhere in particular to go, which is
   * every agent code and every mail that was not sent from a gate. Stored
   * rather than carried in the link, and re-checked on the way out by
   * `safeDestination`. See `009-signin-destination`.
   */
  link_dest: string | null;
  /**
   * The trip this code was issued for, and therefore the only trip the token
   * it produces can write to — `write:trip:<trip_id>`. Null for a guest or
   * signup code, and for an agent code the journal's owner asked for without
   * naming a trip, which is the one case that still mints the unqualified
   * `write:content`. Written when the code is issued and never re-supplied at
   * redemption; see `011-code-trip-binding` and B230.
   */
  trip_id: string | null;
  /**
   * 1 for the welcome mail's link, which never expires and is not swept away
   * when a fresh code is issued for the same address. 0 — the default, and
   * every row written before `006-standing-link` — is a link that dies with
   * its code. Still single use either way; see that migration.
   */
  link_standing: number;
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
  /** B365. Separate from the digest opt-in on purpose — see migration 015. */
  wants_whatsapp: Generated<number>;
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
  /** When `notifyOwnerOfRequest` actually reached the owner, or null while
   * that mail is still owed — B272. Set only on a successful send, so a
   * failure leaves it null and a later re-confirmation retries it rather than
   * the notice being lost for good. See `012-contact-notified`. */
  notified_at: string | null;
};

/**
 * An invitation link — decision 19, as extended by B33.
 *
 * It holds a name and a language and no email, because it is an invitation to
 * *request*, not a grant. Forwarding it can therefore only ever prefill a form
 * for whoever opens it; identity still comes from confirming an address. That
 * is true of all three kinds below, and it is what makes a link safe to put in
 * a group chat.
 */
export type ContactInvitesTable = {
  id: string;
  owner_id: string;
  /**
   * `personal` | `guest` | `buddy`.
   *
   * `personal` is decision 19's original link, `/{user}/i/<token>`, and every
   * row written before B33 is one. `guest` is the same door at a name that
   * says what it opens — `/{user}/invite/guest/<token>` — and leads to being
   * let into the journal. `buddy` leads to being on one trip: writing to it,
   * and holding an agent token scoped to it. The open link that had no row at
   * all, because it carried no secret, was removed in B37.
   */
  kind: Generated<string>;
  token_hash: string;
  /**
   * The token itself, AES-256-GCM under `CONTACTS_ENCRYPTION_KEY` — B280, and
   * `013-invite-token-cipher` for why it is here and what it costs.
   *
   * Null on every row written before that migration, and on any row created
   * while the key is unset. Redemption never reads it: that is `token_hash`,
   * which is indexed. This is only ever decrypted to show an owner the link
   * they already sent.
   */
  token_cipher: string | null;
  name: string | null;
  locale: string | null;
  /** The trip a `buddy` link is a link to join. Null for every other kind.
   * See `010-invite-links` for why this column exists again after 007. */
  trip_id: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  uses: Generated<number>;
  /**
   * The address this invite was mailed to, case-folded — B319 and
   * `014-invite-preapproval`. Null for every link an owner still copies by
   * hand. Compared against a confirming contact's own `email` (also
   * case-folded) to decide whether the owner's typing the address in counts as
   * having vouched for it: a match skips the owner's queue, a mismatch — the
   * link forwarded to somebody else — does not.
   */
  email_key: string | null;
};

/**
 * One row: this contact may read this journal.
 *
 * **Journal-wide, never per-trip.** The table carried a `trip_id` until
 * `007-journal-wide-grants` — always written `*`, honoured by three readers,
 * issued by nothing — and the column is gone because a guest is a guest of the
 * journal, not of a trip (B35, B41). A trip that must be held back from the
 * people let in is `visibility: private`; that is the whole mechanism, and
 * there is deliberately no narrower one to reach for.
 */
export type AccessGrantsTable = {
  id: string;
  owner_id: string;
  contact_id: string;
  /** `read` | `costs` | … — what the grant unlocks. */
  scope: Generated<string>;
  granted_at: string;
  granted_by: string | null;
  expires_at: string | null;
};

/**
 * One row: this contact was let onto this trip — B33.
 *
 * The second source `peopleOf()` reads, beside the `people:` block in
 * `trip.md`. **Additive, never authoritative**: a hand-written `people:` entry
 * works exactly as it always has, and nothing here can take one away.
 *
 * `granted_at` is the whole distinction. A row with it null is a *request* —
 * somebody redeemed a buddy link and is waiting — and reads as no access at
 * all, the same way a `pending` contact does. The owner approving the contact
 * is what fills it in. Expiry is honoured through `grantIsLive` in
 * `lib/grants.ts`, so "live" means one thing across this table and
 * `access_grants`.
 */
export type TripPeopleTable = {
  id: string;
  owner_id: string;
  trip_id: string;
  contact_id: string;
  /** The invite the person came through, when they came through one. */
  invite_id: string | null;
  requested_at: string;
  /** Null while this is only a request. */
  granted_at: string | null;
  granted_by: string | null;
  revoked_at: string | null;
  expires_at: string | null;
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

/**
 * A mailed "are you sure" for something that cannot be undone — see
 * `008-deletions`. The token lives in the owner's mailbox and nowhere else;
 * this row holds its hash, the exact target, and the moment it was spent.
 */
export type DeletionRequestsTable = {
  id: string;
  owner_id: string;
  /** `journal` | `trip`. */
  kind: string;
  /** The trip, when `kind` is `trip`. Null for a journal. */
  trip_id: string | null;
  /** The address the link was mailed to, read from the journal's config. */
  email: string;
  /** sha-256 of the token in the link. */
  token_hash: string;
  created_at: string;
  expires_at: string;
  /** Set before anything is deleted, so the link is single-use even if the
   * deletion itself then fails half way. */
  consumed_at: string | null;
  /** The session that asked. Not a foreign key — that row is deleted by the
   * sweep this request authorises. */
  requested_by: string | null;
};

/**
 * One row per journal, holding the number that decides whether a letter is
 * sent — B366.
 *
 * `owner_id` is the username and the primary key, which is load-bearing
 * rather than tidy: the debit is a single conditional `UPDATE … WHERE
 * owner_id = ? AND balance >= ?` and a second row for the same journal would
 * halve that guard without anything failing. See `016-credits` for why the
 * balance is a column at all rather than a `SUM()` over the ledger.
 *
 * A journal with no row here has a balance of zero, which is what every
 * journal starts with. Nothing back-fills.
 */
export type CreditsTable = {
  owner_id: string;
  balance: Generated<number>;
  updated_at: string;
};

/**
 * Where every credit came from and went — append-only, never updated, never
 * deleted except with the journal itself.
 *
 * `delta` is signed: positive for a grant or a refund, negative for a spend.
 * One signed column rather than a kind plus an unsigned amount, so the audit
 * (`SUM(delta)` against `credits.balance`) cannot be got wrong by forgetting
 * a sign at one call site.
 */
export type CreditLedgerTable = {
  id: string;
  owner_id: string;
  delta: number;
  /** `grant` | `day_mail` | `day_whatsapp` | `digest` | `refund`. */
  reason: string;
  /** `<username>/<trip-id>/<slug>` for a spend, null for a grant. */
  ref: string | null;
  note: string | null;
  created_at: string;
};

export type PaymentsTable = {
  id: string;
  owner_id: string;
  credits: number;
  amount_rappen: number;
  status: Generated<string>;
  /** "twint" | "card", null until the mock Pay button is pressed. */
  method: string | null;
  created_at: string;
  paid_at: string | null;
};

export type Database = {
  users: UsersTable;
  sessions: SessionsTable;
  login_codes: LoginCodesTable;
  contacts: ContactsTable;
  contact_invites: ContactInvitesTable;
  access_grants: AccessGrantsTable;
  trip_people: TripPeopleTable;
  push_subscriptions: PushSubscriptionsTable;
  reactions: ReactionsTable;
  jobs: JobsTable;
  tracking_points: TrackingPointsTable;
  print_orders: PrintOrdersTable;
  deletion_requests: DeletionRequestsTable;
  credits: CreditsTable;
  credit_ledger: CreditLedgerTable;
  payments: PaymentsTable;
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
  "trip_people",
  "push_subscriptions",
  "reactions",
  "jobs",
  "tracking_points",
  "print_orders",
  "deletion_requests",
  "credits",
  "credit_ledger",
  "payments",
] as const satisfies readonly (keyof Database)[];
