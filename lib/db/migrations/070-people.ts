import { sql } from "kysely";
import type { MigrationDb } from "./types";

/**
 * One person across email and phone — B-3007.
 *
 * A sign-in subject is an address or a proved number (`+<digits>`), and before
 * this nothing said that two of them were the same person: Viktoria by phone
 * and Viktoria by email were two people with two home views.
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
 * replaced when the person updates their address elsewhere. Backfilled from
 * `created_via`: a row the owner filed is the owner's until the person writes.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("person_links")
    .addColumn("email", "text", (c) => c.primaryKey().notNull())
    .addColumn("phone", "text", (c) => c.notNull().unique())
    .addColumn("method", "text", (c) => c.notNull())
    .addColumn("linked_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("person_addresses")
    .addColumn("subject", "text", (c) => c.primaryKey().notNull())
    .addColumn("cipher", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .alterTable("contacts")
    .addColumn("address_self", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db
    .updateTable("contacts")
    .set({ address_self: 1 })
    .where("postal_cipher", "is not", null)
    .where((eb) => eb.or([eb("created_via", "is", null), eb("created_via", "not like", sql<string>`'owner%'`)]))
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.alterTable("contacts").dropColumn("address_self").execute();
  await db.schema.dropTable("person_addresses").execute();
  await db.schema.dropTable("person_links").execute();
}
