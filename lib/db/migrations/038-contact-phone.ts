import {
  addressAad,
  decryptAddress,
  decryptString,
  encryptAddress,
  encryptString,
  hasAnyDetail,
  hasContactsKey,
  phoneAad,
} from "../../contacts/crypto";
import type { MigrationDb } from "./types";

/**
 * A guest's mobile number gets a column of its own — B2294 (B2291 D6).
 *
 * Until now the number sat inside the encrypted postal blob
 * (`PostalAddress.tel`), which is fine for a card and useless for signing in:
 * nothing can look a person up by a field inside a ciphertext. Three columns,
 * the phone's twin of `email` / `email_key` / `confirmed_at`:
 *
 * - `phone_cipher` — the number as typed, AES-256-GCM under the contacts key,
 *   bound to its row by `phone:<owner>:<id>`. Still never in the clear.
 * - `phone_key` — an HMAC of its E.164 digits (`phoneKey`), for lookup. It
 *   is the sign-in credential, set only when the owner typed the number or an
 *   SMS code proved it (`phoneColumns` in `lib/contacts`). **Every number
 *   moved here gets none**: most were typed into self-service forms, by
 *   whoever held the link, and a number nobody vouched for must not sign in.
 * - `phone_proven_at` — when an SMS code proved it. Every number moved here is
 *   unproven, because nobody has ever proved one.
 *
 * Existing `tel` values move out of the postal blob; the blob keeps everything
 * else, and becomes null when the number was all it held. Without a contacts
 * key no blob is readable, so there is nothing to move, and the read side
 * still falls back to a `tel` left inside a blob.
 *
 * `contacts.email` stays `NOT NULL`: rebuilding that table in SQLite would
 * cascade-delete every grant. A contact with a phone and no email stores `""`
 * and a unique placeholder `email_key` (`lib/contacts`, `noEmailKey`).
 */
type Row = { id: string; owner_id: string; postal_cipher: string | null; phone_cipher?: string | null };

export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .alterTable("contacts")
    .addColumn("phone_cipher", "text")
    .execute();
  await db.schema.alterTable("contacts").addColumn("phone_key", "text").execute();
  await db.schema.alterTable("contacts").addColumn("phone_proven_at", "text").execute();
  await db.schema
    .createIndex("contacts_owner_phone_key_unique")
    .on("contacts")
    .columns(["owner_id", "phone_key"])
    .unique()
    .execute();

  if (!hasContactsKey()) return;
  const rows: Row[] = await db
    .selectFrom("contacts")
    .select(["id", "owner_id", "postal_cipher"])
    .where("postal_cipher", "is not", null)
    .orderBy("created_at")
    .execute();
  for (const row of rows) {
    const aad = addressAad(row.owner_id, row.id);
    const address = decryptAddress(row.postal_cipher, aad);
    if (!address || address.tel.trim() === "") continue;
    const rest = { ...address, tel: "" };
    await db
      .updateTable("contacts")
      .set({
        phone_cipher: encryptString(address.tel, phoneAad(row.owner_id, row.id)),
        postal_cipher: hasAnyDetail(rest) ? encryptAddress(rest, aad) : null,
      })
      .where("id", "=", row.id)
      .execute();
  }
}

export async function down(db: MigrationDb): Promise<void> {
  // Put each number back into the blob it came from, so rolling back loses
  // nothing a person typed.
  if (hasContactsKey()) {
    const rows: Row[] = await db
      .selectFrom("contacts")
      .select(["id", "owner_id", "postal_cipher", "phone_cipher"])
      .where("phone_cipher", "is not", null)
      .execute();
    for (const row of rows) {
      const tel = decryptString(row.phone_cipher ?? null, phoneAad(row.owner_id, row.id), "phone");
      if (!tel) continue;
      const aad = addressAad(row.owner_id, row.id);
      const address = decryptAddress(row.postal_cipher, aad) ?? {
        name: "", line1: "", line2: "", postcode: "", city: "", country: "", tel: "",
      };
      await db
        .updateTable("contacts")
        .set({ postal_cipher: encryptAddress({ ...address, tel }, aad) })
        .where("id", "=", row.id)
        .execute();
    }
  }
  await db.schema.dropIndex("contacts_owner_phone_key_unique").execute();
  await db.schema.alterTable("contacts").dropColumn("phone_proven_at").execute();
  await db.schema.alterTable("contacts").dropColumn("phone_key").execute();
  await db.schema.alterTable("contacts").dropColumn("phone_cipher").execute();
}
