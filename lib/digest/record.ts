import "server-only";
import { getDatabase, newId } from "../db";
import type { Locale } from "../types";

/**
 * What was sent to whom, and how far it read — the idempotency record.
 *
 * The shape of the guarantee: a row is **claimed before the transport is
 * called** and confirmed after. A run that dies between two readers has
 * already written the row for everyone it finished, so a re-run computes
 * "nothing new since the cursor" for them and mails nobody twice.
 *
 * The awkward case is a crash *between* the send and the confirm, which leaves
 * a row at `sending` and nobody knowing whether the mail left. That row counts
 * as delivered. It is the deliberate choice of the two harms: a reader who
 * misses one weekly digest sees those days in the next one — the cursor only
 * advanced past days that were, at worst, actually mailed — while a reader who
 * gets the same digest twice learns that this sender cannot be trusted.
 *
 * A `failed` row is different: the transport threw, so the mail definitely did
 * not go, and the next run treats it as if the attempt had never happened.
 */

export type DigestSendStatus = "sending" | "sent" | "failed";

export type DigestSendRecord = {
  id: string;
  contactId: string;
  status: DigestSendStatus;
  /** The newest day date this digest covered, `YYYY-MM-DD`. */
  cursor: string;
  dayCount: number;
  locale: Locale | null;
  mailRef: string | null;
  /** When the attempt began — what the "one a day" rule reads. */
  createdAt: string;
  sentAt: string | null;
};

function toStatus(value: string): DigestSendStatus {
  return value === "sent" || value === "failed" ? value : "sending";
}

/**
 * The last attempt that counts, per contact, for one owner.
 *
 * `failed` rows are skipped: they represent a reader who got nothing, and the
 * next run should try again rather than pretend they are up to date.
 */
export async function lastDigestsByContact(
  owner: string,
): Promise<Map<string, DigestSendRecord>> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("digest_sends")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("status", "in", ["sending", "sent"])
    .orderBy("created_at", "asc")
    .execute();

  const out = new Map<string, DigestSendRecord>();
  for (const row of rows) {
    // Ordered ascending, so the last write per contact wins.
    out.set(row.contact_id, {
      id: row.id,
      contactId: row.contact_id,
      status: toStatus(row.status),
      cursor: row.cursor,
      dayCount: row.day_count,
      locale: (row.locale as Locale | null) ?? null,
      mailRef: row.mail_ref,
      createdAt: row.created_at,
      sentAt: row.sent_at,
    });
  }
  return out;
}

export type ClaimInput = {
  contactId: string;
  cursor: string;
  dayCount: number;
  locale: Locale;
  /** `[{ ref, days }]`, for the human reading this table later. */
  trips: { ref: string; days: number }[];
  now: Date;
};

/** Write "we are about to mail this" and return the row id. */
export async function claimDigest(owner: string, input: ClaimInput): Promise<string> {
  const { db } = await getDatabase();
  const id = newId();
  await db
    .insertInto("digest_sends")
    .values({
      id,
      owner_id: owner,
      contact_id: input.contactId,
      status: "sending",
      cursor: input.cursor,
      day_count: input.dayCount,
      trips: JSON.stringify(input.trips),
      locale: input.locale,
      mail_ref: null,
      error: null,
      created_at: input.now.toISOString(),
      sent_at: null,
    })
    .execute();
  return id;
}

export async function markDigestSent(
  owner: string,
  id: string,
  mailRef: string | null,
  now: Date,
): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("digest_sends")
    .set({ status: "sent", mail_ref: mailRef, sent_at: now.toISOString() })
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .execute();
}

export async function markDigestFailed(
  owner: string,
  id: string,
  message: string,
): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("digest_sends")
    .set({ status: "failed", error: message.slice(0, 500) })
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .execute();
}
