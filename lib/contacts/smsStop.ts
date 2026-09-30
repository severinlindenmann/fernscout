import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDatabase } from "../db";

/**
 * A stop-only link for the SMS news a reader receives (B2442; wave 2
 * security review, L2). The manage token would open the reader's whole
 * self-serve page — details, postal address, delete — and an SMS body lives
 * in provider logs, lock screens and forwarded texts. This token proves one
 * thing only: "stop SMS from this journal to this contact". HMAC-signed with
 * `SESSION_SECRET` over the journal, the contact and the channel, so it
 * cannot be widened or moved to another journal. Absent secret ⇒ no token
 * (the caller keeps the older stream-scoped link).
 */

const MAC_LENGTH = 16;

function mac(owner: string, contactId: string, secret: string): string {
  return createHmac("sha256", secret).update(`smsstop:${owner}:${contactId}`).digest("base64url").slice(0, MAC_LENGTH);
}

export function smsStopToken(owner: string, contactId: string): string | null {
  const secret = process.env.SESSION_SECRET;
  return secret ? `${contactId}.${mac(owner, contactId, secret)}` : null;
}

/** The contact id a well-formed, correctly signed token names, else null. */
export function resolveSmsStopToken(owner: string, token: string): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const contactId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(owner, contactId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return contactId;
}

/** Turns off SMS news for this one contact of this one journal — nothing else. */
export async function stopSmsFor(owner: string, contactId: string): Promise<void> {
  const { db } = await getDatabase();
  await db.updateTable("contacts").set({ wants_sms: 0 }).where("owner_id", "=", owner).where("id", "=", contactId).execute();
}
