import "server-only";
import { getDatabaseOrNull, nowIso } from "./db";
import { getUser } from "./users";

/**
 * Where the owner's own telephone number lives now — B1654.
 *
 * `owner.email` stays in `config.json` (it is the journal's own ownership
 * claim); `owner.tel` is a notification channel and moved to a database row,
 * one per journal, alongside `contacts` and `credits`. See
 * `lib/db/migrations/034-owner-tel.ts` for the shape and the reasoning.
 *
 * **A number already on disk keeps working with no migration script.** A
 * journal with no `owner_tel` row at all falls back, on read, to whatever
 * `config.json` still carries — which is every journal written before this
 * table existed, and every journal `createJournal` still writes a number
 * into at signup (that write path is unchanged; only the post-signup EDIT
 * moved). The first `setOwnerTel`/`clearOwnerTel` call for a journal creates
 * its row for good, and from then on the row is authoritative: a row with
 * `tel: null` means "explicitly cleared", and must never fall back to a
 * number still sitting in the file.
 *
 * **`setOwnerTel` is proof-only, and there is no other writer.** An owner
 * token that could set this field to a number of its own choosing would be
 * an exfiltration path — `lib/digest/dayWhatsapp.ts` sends the owner's own
 * copy of every published day to whatever number is on file — so the only
 * caller of `setOwnerTel` is `.../owner/tel/verify/redeem`
 * (`app/api/v2/[user]/owner/tel/verify/redeem/route.ts`), after
 * `checkVerification` from `lib/phoneVerify` has confirmed the caller
 * received a passcode at that number. Do not add a second one; a field that
 * can be set without proof of possession is the same mistake `PATCH
 * /api/v1/{user}/config` made, one layer down.
 */

export const OWNER_TEL_PROVEN_METHODS = ["sms", "operator", "whatsapp-inbound"] as const;
export type OwnerTelProvenMethod = (typeof OWNER_TEL_PROVEN_METHODS)[number];

export type OwnerTelRecord = {
  /** E.164 digits, already normalised. */
  tel: string;
  provenAt: string | null;
  provenMethod: OwnerTelProvenMethod | null;
};

function isProvenMethod(value: string | null): value is OwnerTelProvenMethod {
  return value !== null && (OWNER_TEL_PROVEN_METHODS as readonly string[]).includes(value);
}

/** The number this journal's WhatsApp channel sends to, or `null` when there
 * is none — whichever of the DB row or the file answers. */
export async function getOwnerTel(username: string): Promise<OwnerTelRecord | null> {
  const handle = await getDatabaseOrNull();
  if (handle) {
    const row = await handle.db
      .selectFrom("owner_tel")
      .selectAll()
      .where("owner_id", "=", username)
      .executeTakeFirst();
    if (row) {
      // A row exists: it is authoritative, whatever the file still says.
      // `tel: null` is an explicit clear, not "look elsewhere".
      if (!row.tel) return null;
      return {
        tel: row.tel,
        provenAt: row.proven_at,
        provenMethod: isProvenMethod(row.proven_method) ? row.proven_method : null,
      };
    }
  }
  // No row yet (or no database at all) — the number this journal has had
  // since before this table existed, if any.
  const user = getUser(username);
  if (!user?.owner?.tel) return null;
  return {
    tel: user.owner.tel,
    provenAt: user.owner.telProvenAt ?? null,
    provenMethod: isProvenMethod(user.owner.telProvenMethod ?? null) ? (user.owner.telProvenMethod as OwnerTelProvenMethod) : null,
  };
}

async function upsert(
  username: string,
  tel: string | null,
  provenAt: string | null,
  provenMethod: OwnerTelProvenMethod | null,
): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) {
    throw new Error("owner_tel: no database is configured, so there is nowhere to store a number");
  }
  const updated_at = nowIso();
  const existing = await handle.db
    .selectFrom("owner_tel")
    .select("owner_id")
    .where("owner_id", "=", username)
    .executeTakeFirst();
  if (existing) {
    await handle.db
      .updateTable("owner_tel")
      .set({ tel, proven_at: provenAt, proven_method: provenMethod, updated_at })
      .where("owner_id", "=", username)
      .execute();
  } else {
    await handle.db
      .insertInto("owner_tel")
      .values({ owner_id: username, tel, proven_at: provenAt, proven_method: provenMethod, updated_at })
      .execute();
  }
}

/** Written only after `checkVerification` (`lib/phoneVerify`) has confirmed
 * the caller received a passcode at `tel` — see the note above. `provenAt`
 * defaults to now; a caller never has a reason to backdate it. */
export async function setOwnerTel(
  username: string,
  tel: string,
  provenMethod: OwnerTelProvenMethod,
  provenAt: string = nowIso(),
): Promise<void> {
  await upsert(username, tel, provenAt, provenMethod);
}

/** Clears the number — the owner's own way of switching their WhatsApp copy
 * back off. Writes a row rather than deleting one, so a number still on disk
 * in `config.json` is not mistaken for "not cleared yet". */
export async function clearOwnerTel(username: string): Promise<void> {
  await upsert(username, null, null, null);
}

/** The plain shape `ownerTelDoc` (`lib/api/v2/schemas/ownerTel.ts`) parses —
 * kept here, not shared between the two `owner/tel` route files, because
 * `test/api-v2-imports.test.ts` refuses a v2 route importing another
 * route's glue: each call site parses this through its own `ownerTelDoc`
 * import instead. */
export async function ownerTelDocFields(username: string): Promise<{
  tel: string | null;
  provenAt: string | null;
  provenMethod: OwnerTelProvenMethod | null;
}> {
  const record = await getOwnerTel(username);
  return { tel: record?.tel ?? null, provenAt: record?.provenAt ?? null, provenMethod: record?.provenMethod ?? null };
}
