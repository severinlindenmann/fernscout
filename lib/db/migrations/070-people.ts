import type { MigrationDb } from "./types";

/**
 * One person across email and phone — B-3007.
 *
 * A sign-in subject is an address or a proved number (`+<digits>`), and before
 * this nothing said that two of them were the same person: Viktoria by phone
 * and Viktoria by email were two people with two home views.
 *
 * Both tables belong to no journal: `owner_id` is always `NO_JOURNAL` ("*"),
 * as in 045–048, so every table still carries one (ROADMAP §0.5) and a
 * journal's deletion leaves the person's own records alone.
 *
 * `person_links` pairs one proved address with one proved number. A row is
 * written only when one browser proved both (`linkPerson`); an owner's own
 * proven number counts as a link without a row (`lib/people.ts`).
 *
 * `person_addresses` is the person's own postal address, once for the whole
 * instance, keyed by the person's canonical subject and encrypted like a
 * contact's (`CONTACTS_ENCRYPTION_KEY`, AAD `person:<subject>`).
 *
 * `contacts.address_self` says whether the address on a contact row was
 * written by the person (1) or typed by the owner (0). Only the former is
 * replaced when the person updates their address elsewhere. No backfill:
 * nothing on an existing row proves who typed its address (an owner can file,
 * import and confirm a row alone), so every row starts as 0 and becomes the
 * person's the first time they save it signed in as that contact.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("person_links")
    .addColumn("owner_id", "text", (c) => c.notNull().defaultTo("*"))
    .addColumn("email", "text", (c) => c.primaryKey().notNull())
    .addColumn("phone", "text", (c) => c.notNull().unique())
    .addColumn("method", "text", (c) => c.notNull())
    .addColumn("linked_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("person_addresses")
    .addColumn("owner_id", "text", (c) => c.notNull().defaultTo("*"))
    .addColumn("subject", "text", (c) => c.primaryKey().notNull())
    .addColumn("cipher", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .alterTable("contacts")
    .addColumn("address_self", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contacts").dropColumn("address_self").execute();
  await db.schema.dropTable("person_addresses").execute();
  await db.schema.dropTable("person_links").execute();
}
