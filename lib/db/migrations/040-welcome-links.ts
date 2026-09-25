import type { MigrationDb } from "./types";

/**
 * The welcome link and the invite channels — B2292 (B2291 "Links", "Credits").
 *
 * - `welcome_code_hash` / `welcome_code_cipher` — the per-person `/w/<code>`
 *   link: a sha-256 for lookup (unique across the instance, because `/w/` has
 *   no username in it) and an AES-256-GCM copy so the owner can show the same
 *   link again (the shape `013-invite-token-cipher` gave invite tokens). The
 *   code grants nothing: it opens a guide whose next step sends a code to the
 *   channel the owner typed.
 * - `invited_via` / `invited_at` — the last channel the owner chose to tell
 *   the person on (`email` | `whatsapp` | `sms` | `self`) and when.
 * - `welcome_opened_at` — when the welcome link was first opened. Resending is
 *   offered only while this is null.
 * - `wants_sms` — the reader's consent to hear about new days by SMS, a
 *   separate consent from WhatsApp for the reason `015-contact-whatsapp`
 *   gives for that one.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .alterTable("contacts")
    .addColumn("wants_sms", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable("contacts").addColumn("welcome_code_hash", "text").execute();
  await db.schema.alterTable("contacts").addColumn("welcome_code_cipher", "text").execute();
  await db.schema.alterTable("contacts").addColumn("invited_via", "text").execute();
  await db.schema.alterTable("contacts").addColumn("invited_at", "text").execute();
  await db.schema.alterTable("contacts").addColumn("welcome_opened_at", "text").execute();
  await db.schema
    .createIndex("contacts_welcome_code_hash_unique")
    .on("contacts")
    .column("welcome_code_hash")
    .unique()
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("contacts_welcome_code_hash_unique").execute();
  for (const column of [
    "welcome_opened_at",
    "invited_at",
    "invited_via",
    "welcome_code_cipher",
    "welcome_code_hash",
    "wants_sms",
  ]) {
    await db.schema.alterTable("contacts").dropColumn(column).execute();
  }
}
