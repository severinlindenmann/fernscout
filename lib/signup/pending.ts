import "server-only";
import { getDatabase } from "../db";
import { journalForNumber } from "../registry";
// The literal, not an import: lib/auth imports this module (adoptPendingSignup).
const NO_JOURNAL = "*";

/**
 * Pending signups — B2804. What survives a closed tab between "the address
 * is proven" and "the journal exists". See migration `067-pending-signups`.
 *
 * Nothing here is a credential. A row says "this address redeemed a signup
 * code at <time>" and optionally "and proved this number at <time>"; it is
 * only ever read by a caller that already holds a signup session for the
 * same address (`openSession`) or a cookie-proven identity (`/welcome`).
 */

/** The address proof lives this long past its moment before the nightly sweep removes it. */
const PENDING_TTL_MS = 8 * 24 * 60 * 60 * 1000;
/** A number proven earlier than this is asked for again. */
const PHONE_PROOF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const norm = (email: string) => email.trim().toLowerCase();

export type PendingSignup = {
  email: string;
  emailProvenAt: string;
  locale: string | null;
  phone: string | null;
  phoneProvenAt: string | null;
  phoneProvenMethod: string | null;
};

/** The address just proved itself: insert, or refresh the proof time of the row already there. */
export async function recordPendingEmail(email: string, locale?: string | null): Promise<void> {
  const { db } = await getDatabase();
  const now = new Date().toISOString();
  await db
    .insertInto("pending_signups")
    .values({ owner_id: NO_JOURNAL, email: norm(email), email_proven_at: now, locale: locale ?? null, created_at: now })
    .onConflict((oc) => oc.column("email").doUpdateSet({ email_proven_at: now }))
    .execute();
}

/** A number was proven for this address. Updates only: the row exists from the redeem. */
export async function recordPendingPhone(
  email: string,
  phone: string,
  method: "sms" | "whatsapp-inbound",
): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("pending_signups")
    .set({ phone, phone_proven_at: new Date().toISOString(), phone_proven_method: method })
    .where("email", "=", norm(email))
    .execute();
}

export async function getPendingSignup(email: string): Promise<PendingSignup | null> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("pending_signups")
    .selectAll()
    .where("email", "=", norm(email))
    .executeTakeFirst();
  if (!row) return null;
  if (Date.now() - new Date(row.email_proven_at).getTime() > PENDING_TTL_MS) return null;
  return {
    email: row.email,
    emailProvenAt: row.email_proven_at,
    locale: row.locale,
    phone: row.phone,
    phoneProvenAt: row.phone_proven_at,
    phoneProvenMethod: row.phone_proven_method,
  };
}

/**
 * The number proof worth carrying into a new signup session: recorded, no
 * older than seven days, and not meanwhile taken by a journal (that would
 * only fail later, at create).
 */
export function livePhoneProof(
  pending: PendingSignup | null,
): { phone: string; provenAt: string; method: string | null } | null {
  if (!pending?.phone || !pending.phoneProvenAt) return null;
  if (Date.now() - new Date(pending.phoneProvenAt).getTime() > PHONE_PROOF_TTL_MS) return null;
  if (journalForNumber(pending.phone)) return null;
  return { phone: pending.phone, provenAt: pending.phoneProvenAt, method: pending.phoneProvenMethod };
}

/** The journal exists; the row has done its job. */
export async function deletePendingSignup(email: string): Promise<void> {
  const { db } = await getDatabase();
  await db.deleteFrom("pending_signups").where("email", "=", norm(email)).execute();
}

/** The nightly sweep. Returns how many rows went. */
export async function purgePendingSignups(now = Date.now()): Promise<number> {
  const { db } = await getDatabase();
  const cutoff = new Date(now - PENDING_TTL_MS).toISOString();
  const res = await db.deleteFrom("pending_signups").where("email_proven_at", "<", cutoff).executeTakeFirst();
  return Number(res.numDeletedRows ?? 0);
}
