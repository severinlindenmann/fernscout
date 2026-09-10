import "server-only";
import crypto from "node:crypto";
import { NO_JOURNAL, hashSecret } from "../auth";
import { getDatabase } from "../db";
import { toE164 } from "../whatsapp/phone";
import { whatsappDisplayNumber } from "../whatsapp/settings";

/**
 * Proving a number by receiving a message from it — B1234.
 *
 * The outbound proof (a passcode in an authentication template) is gated on
 * a Meta business verification this instance's operator cannot pass, and a
 * utility template carrying a code is auto-rejected (B1232). An inbound
 * message needs none of that: the signup page shows a wa.me link whose
 * prefilled text carries a one-time token, the person taps send, and the
 * webhook seeing that token arrive *from* a number is the proof — free, no
 * template, and nobody types a code.
 *
 * Storage is `login_codes` with `kind: "phone-link"`, the same table and
 * discipline as every other one-time credential here: only the token's hash
 * is stored, thirty minutes, superseded on reissue, single use. Column
 * reuse, following the file's own precedent: `email` holds the E.164 the
 * webhook proved (empty until then), `trip_id` holds the signup session id
 * the row is bound to, `link_dest` holds the locale the confirmation reply
 * should be written in, and `link_consumed_at` is the instant the webhook
 * claimed it.
 */

const TTL_MS = 30 * 60 * 1000;
const KIND = "phone-link";

/** Unambiguous alphabet — no 0/O, no 1/I/L — because a person may end up
 * reading this aloud to somebody after all. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** `FS-XXXXXXXX` anywhere in a message, case-insensitively. Strict enough
 * that ordinary helper chat never trips it. */
const PHONE_LINK_TOKEN_RE = /\bFS-([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8})\b/i;

function generateToken(): string {
  let out = "FS-";
  const bytes = crypto.randomBytes(8);
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export type PhoneLink = { id: string; token: string; link: string; text: string };

/**
 * The message the person sends us. English on purpose, whatever the UI's
 * language: it is machine-addressed (the token is the payload), it must
 * survive being edited down to just the token, and a translated sentence
 * here would be a fourth string to keep in three locale files for a message
 * no human is the audience of.
 */
function prefillText(token: string): string {
  return `Fernscout signup ${token} - sending this message confirms my number.`;
}

/** Refused (null) when the instance has no WhatsApp number configured —
 * `features.whatsapp.number`, the same one printed beside the helper. */
export async function createPhoneLink(sessionId: string, locale: string): Promise<PhoneLink | null> {
  const display = whatsappDisplayNumber();
  const number = display ? toE164(display) : null;
  if (!number) return null;

  const { db } = await getDatabase();
  const now = new Date();

  // Supersede this session's earlier links — asking again must not leave two
  // live tokens.
  await db
    .updateTable("login_codes")
    .set({ consumed_at: now.toISOString() })
    .where("owner_id", "=", NO_JOURNAL)
    .where("kind", "=", KIND)
    .where("trip_id", "=", sessionId)
    .where("consumed_at", "is", null)
    .execute();

  const id = crypto.randomUUID();
  const token = generateToken();
  await db
    .insertInto("login_codes")
    .values({
      id,
      owner_id: NO_JOURNAL,
      email: "",
      code_hash: hashSecret(token.toUpperCase()),
      link_hash: null,
      link_consumed_at: null,
      link_dest: locale,
      trip_id: sessionId,
      kind: KIND,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
      consumed_at: null,
      link_standing: 0,
      attempts: 0,
    })
    .execute();

  const text = prefillText(token);
  return {
    id,
    token,
    link: `https://wa.me/${number}?text=${encodeURIComponent(text)}`,
    text,
  };
}

export type ClaimOutcome = { outcome: "confirmed" | "expired"; locale: string } | null;

/**
 * The webhook's half: a text message that carries a token. `null` means "no
 * token in this message" and the caller carries on with the ordinary
 * pipeline; anything else means the message was for us and has been
 * answered for.
 */
export async function claimPhoneLink(body: string, from: string): Promise<ClaimOutcome> {
  const match = body.match(PHONE_LINK_TOKEN_RE);
  if (!match) return null;
  const supplied = hashSecret(`FS-${match[1].toUpperCase()}`);

  const { db } = await getDatabase();
  const row = await db
    .selectFrom("login_codes")
    .selectAll()
    .where("kind", "=", KIND)
    .where("code_hash", "=", supplied)
    .executeTakeFirst();

  // A token that matches the shape but no live row: superseded, expired,
  // already used, or invented. One answer for all of them.
  if (!row || row.consumed_at || row.link_consumed_at) return { outcome: "expired", locale: "en" };
  const locale = row.link_dest || "en";
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { outcome: "expired", locale };
  }

  await db
    .updateTable("login_codes")
    .set({ email: from, link_consumed_at: new Date().toISOString() })
    .where("id", "=", row.id)
    .execute();
  return { outcome: "confirmed", locale };
}

export type PollResult =
  | { status: "pending" }
  | { status: "ok"; phone: string }
  | { status: "expired" };

/**
 * The browser's half, polled: bound to the session that created the link,
 * so one signup cannot collect another's proof. Consumes the row on
 * success — the proof then lives on the signup session, not here.
 */
export async function pollPhoneLink(id: string, sessionId: string): Promise<PollResult> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("login_codes")
    .selectAll()
    .where("id", "=", id)
    .where("kind", "=", KIND)
    .where("trip_id", "=", sessionId)
    .executeTakeFirst();

  if (!row || row.consumed_at) return { status: "expired" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { status: "expired" };
  if (!row.link_consumed_at || !row.email) return { status: "pending" };

  await db.updateTable("login_codes").set({ consumed_at: new Date().toISOString() }).where("id", "=", row.id).execute();
  return { status: "ok", phone: row.email };
}
