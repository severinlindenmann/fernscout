import "server-only";
import { NO_JOURNAL } from "../auth";
import { getDatabase, getDatabaseOrNull, newId, nowIso } from "../db";

/**
 * The rows behind /admin's SMS panel — B1316. Writing and reading only;
 * what a message *means* is nobody's to decide here, which is why there is
 * no status, no read-flag and no thread: the operator reads a list.
 */

const DIRECTIONS = ["in", "out"] as const;
export type SmsDirection = (typeof DIRECTIONS)[number];

export type SmsRecord = {
  id: string;
  direction: SmsDirection;
  from: string;
  to: string;
  body: string;
  providerSid: string | null;
  createdAt: string;
};

/**
 * Record one message. Returns false when `providerSid` has been seen
 * before — the UNIQUE constraint on the column, which is the whole inbound
 * dedupe (see 031-sms-messages). `onConflict` works on both dialects, so
 * a retry from Twilio is one no-op insert rather than a caught error.
 */
export async function recordSms(row: {
  direction: SmsDirection;
  from: string;
  to: string;
  body: string;
  providerSid: string | null;
}): Promise<boolean> {
  const { db } = await getDatabase();
  const result = await db
    .insertInto("sms_messages")
    .values({
      id: newId(),
      owner_id: NO_JOURNAL,
      direction: row.direction,
      from_e164: row.from,
      to_e164: row.to,
      body: row.body,
      provider_sid: row.providerSid,
      created_at: nowIso(),
    })
    .onConflict((oc) => oc.column("provider_sid").doNothing())
    .executeTakeFirst();
  return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
}

/** The latest messages, newest first — the one question the table is asked.
 * Empty with no database: a dry-run checkout without one still sends, it
 * just has no list to show. */
export async function listSms(limit = 200): Promise<SmsRecord[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const { db } = handle;
  const rows = await db
    .selectFrom("sms_messages")
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    direction: r.direction === "in" ? "in" : "out",
    from: r.from_e164,
    to: r.to_e164,
    body: r.body,
    providerSid: r.provider_sid,
    createdAt: r.created_at,
  }));
}
