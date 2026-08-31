import type { MigrationDb } from "./types";

/**
 * One contact record, and the links that lead people to it.
 *
 * ROADMAP §3.1: the same person was being asked for the same details three
 * times — once to be approved as a guest, once to choose a channel, once to
 * receive a postcard. This migration finishes the single record `001-initial`
 * sketched: it gains the two explicit consents, the postal address, and the
 * provenance and timestamps the owner needs to decide whether to let someone
 * in.
 *
 * Two things are deliberately not columns:
 *
 * - **The postal address is one opaque blob**, `postal_cipher`, not a set of
 *   street/town/country columns. It is AES-256-GCM ciphertext (see
 *   `lib/contacts/crypto.ts`), and a column per field would leak the shape of
 *   the data, invite a `where city = …` that cannot work, and tempt somebody
 *   into storing one field in the clear.
 * - **The manage token is stored hashed**, like every other bearer credential
 *   in this schema. The link in the mail footer is the only copy.
 *
 * `contact_invites` is the personal link of decision 19. It carries a name and
 * a language and nothing else — no email, no grant. That is what makes a
 * forwarded link harmless: it can prefill a form, and prefilling is not
 * identity.
 */
export async function up(db: MigrationDb): Promise<void> {
  const columns = [
    // AES-256-GCM ciphertext of the postal address, or null. Never a column
    // per field: see the note above.
    "postal_cipher",
    // Provenance: "invite:<id>", "open", or "owner". Which link brought
    // someone in is the first thing you want when approving them.
    "created_via",
    // Double opt-in: set when the address was proved with a one-time code.
    "confirmed_at",
    // Set when the owner waved them in. Confirming is not being approved.
    "approved_at",
    "last_seen_at",
    // sha-256 of the self-serve edit/unsubscribe token.
    "manage_token_hash",
  ];

  for (const name of columns) {
    await db.schema.alterTable("contacts").addColumn(name, "text").execute();
  }

  // Two consents, never one. "Send me an email" and "send me something
  // through the post" are different questions with different consequences,
  // and a single "notify me" checkbox would be answering both at once.
  for (const name of ["wants_email_digest", "wants_postcard"]) {
    await db.schema
      .alterTable("contacts")
      .addColumn(name, "integer", (c) => c.notNull().defaultTo(0))
      .execute();
  }

  await db.schema
    .createIndex("contacts_manage_token")
    .on("contacts")
    .columns(["manage_token_hash"])
    .execute();

  await db.schema
    .createIndex("contacts_owner_status")
    .on("contacts")
    .columns(["owner_id", "status"])
    .execute();

  await db.schema
    .createTable("contact_invites")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    // "personal" today. The open link needs no row: it is one URL per user
    // and carries no secret, which is exactly why it needs a rate limit.
    .addColumn("kind", "text", (c) => c.notNull().defaultTo("personal"))
    .addColumn("token_hash", "text", (c) => c.notNull())
    // Baked into the link so the landing page can greet someone by name and
    // open in their language. Both are prefill, neither is identity.
    .addColumn("name", "text")
    .addColumn("locale", "text")
    .addColumn("trip_id", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("expires_at", "text")
    .addColumn("revoked_at", "text")
    // Counted, not limited: a link that was meant for one grandmother and has
    // been used eleven times is worth noticing.
    .addColumn("uses", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex("contact_invites_token")
    .on("contact_invites")
    .columns(["token_hash"])
    .unique()
    .execute();

  await db.schema
    .createIndex("contact_invites_owner")
    .on("contact_invites")
    .columns(["owner_id", "created_at"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("contact_invites_owner").execute();
  await db.schema.dropIndex("contact_invites_token").execute();
  await db.schema.dropTable("contact_invites").execute();

  await db.schema.dropIndex("contacts_owner_status").execute();
  await db.schema.dropIndex("contacts_manage_token").execute();

  for (const name of [
    "wants_postcard",
    "wants_email_digest",
    "manage_token_hash",
    "last_seen_at",
    "approved_at",
    "confirmed_at",
    "created_via",
    "postal_cipher",
  ]) {
    await db.schema.alterTable("contacts").dropColumn(name).execute();
  }
}
