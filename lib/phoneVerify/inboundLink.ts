import "server-only";
import crypto from "node:crypto";
import { NO_JOURNAL, hashSecret } from "../auth";
import { getDatabase } from "../db";
import { whatsappNumberForUrl } from "../contactNumber";
import { journalForNumber } from "../registry";
import { recordPendingPhone } from "../signup/pending";

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
 * webhook proved (empty until then), `trip_id` holds the signup address
 * the row is bound to (B2804: the address, not the session, so a link outlives its tab), `link_dest` holds the locale the confirmation reply
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

/** @public open core: paid/ uses this (tagged by open-core/split). */
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
export async function createPhoneLink(boundTo: string, locale: string): Promise<PhoneLink | null> {
  const number = whatsappNumberForUrl();
  if (!number) return null;

  const { db } = await getDatabase();
  const now = new Date();

  // Supersede this signup's earlier links — asking again must not leave two
  // live tokens.
  await db
    .updateTable("login_codes")
    .set({ consumed_at: now.toISOString() })
    .where("owner_id", "=", NO_JOURNAL)
    .where("kind", "=", KIND)
    .where("trip_id", "=", boundTo)
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
      trip_id: boundTo,
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

/** @public open core: paid/ uses this (tagged by open-core/split). */
export type ClaimOutcome = { outcome: "confirmed" | "expired" | "taken"; locale: string } | null;

/**
 * The webhook's half: a text message that carries a token. `null` means "no
 * token in this message" and the caller carries on with the ordinary
 * pipeline; anything else means the message was for us and has been
 * answered for.
 */
/** @public open core: paid/ uses this (tagged by open-core/split). */
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
  // B-2942. A reader-link row (bound to `join:...`) only records the sender;
  // the starting browser's poll compares it with the typed number. It never
  // becomes a pending signup proof.
  if (row.trip_id?.startsWith(JOIN_PREFIX)) return { outcome: "confirmed", locale };
  // B2805. A number that already keeps a journal proves nothing new: no
  // pending proof is written, and the poll answers tel_taken. (The webhook
  // reply for "taken" is paid/'s to word; today it reads as "expired".)
  if (journalForNumber(from)) return { outcome: "taken", locale };
  // B2804. The row is bound to the pending address, never to what the
  // message says, so this proof cannot land on any other address.
  await recordPendingPhone(row.trip_id ?? "", from, "whatsapp-inbound");
  return { outcome: "confirmed", locale };
}

/** @public open core: paid/ uses this (tagged by open-core/split). */
export type PollResult =
  | { status: "pending" }
  | { status: "ok"; phone: string }
  | { status: "tel_taken" }
  | { status: "expired" };

/**
 * The browser's half, polled: bound to the address that created the link,
 * so one signup cannot collect another's proof. Consumes the row on
 * success — the proof then lives on the signup session, not here.
 */
export async function pollPhoneLink(id: string, boundTo: string): Promise<PollResult> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("login_codes")
    .selectAll()
    .where("id", "=", id)
    .where("kind", "=", KIND)
    .where("trip_id", "=", boundTo)
    .executeTakeFirst();

  if (!row || row.consumed_at) return { status: "expired" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { status: "expired" };
  if (!row.link_consumed_at || !row.email) return { status: "pending" };
  if (journalForNumber(row.email)) {
    await db.updateTable("login_codes").set({ consumed_at: new Date().toISOString() }).where("id", "=", row.id).execute();
    return { status: "tel_taken" };
  }

  await db.updateTable("login_codes").set({ consumed_at: new Date().toISOString() }).where("id", "=", row.id).execute();
  return { status: "ok", phone: row.email };
}

/**
 * The reader link's variant - B-2942. Same table, same token and message, but
 * the row is bound not to a signup address but to
 * `join:<inviteId>:<sha256(secret)>:<typed digits>`: the link, a secret only
 * the starting browser holds (an httpOnly cookie), and the number the person
 * typed. Ten minutes, single use. `claimPhoneLink` records the sender on it
 * without writing any pending proof.
 */
const JOIN_PREFIX = "join:";
const JOIN_TTL_MS = 10 * 60 * 1000;

function joinBinding(inviteId: string, secret: string, typedDigits: string): string {
  return `${JOIN_PREFIX}${inviteId}:${hashSecret(secret)}:${typedDigits}`;
}

export type JoinPhoneLink = PhoneLink & { secret: string; expiresAt: string };

export async function createJoinPhoneLink(
  inviteId: string,
  typedDigits: string,
  locale: string,
  previousSecret?: string | null,
): Promise<JoinPhoneLink | null> {
  const number = whatsappNumberForUrl();
  if (!number) return null;
  const { db } = await getDatabase();
  const now = new Date();
  // Asking again from the same browser supersedes its earlier link.
  if (previousSecret) {
    await db
      .updateTable("login_codes")
      .set({ consumed_at: now.toISOString() })
      .where("owner_id", "=", NO_JOURNAL)
      .where("kind", "=", KIND)
      .where("trip_id", "like", `${JOIN_PREFIX}${inviteId}:${hashSecret(previousSecret)}:%`)
      .where("consumed_at", "is", null)
      .execute();
  }
  const secret = crypto.randomBytes(24).toString("base64url");
  const id = crypto.randomUUID();
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + JOIN_TTL_MS).toISOString();
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
      trip_id: joinBinding(inviteId, secret, typedDigits),
      kind: KIND,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      consumed_at: null,
      link_standing: 0,
      attempts: 0,
    })
    .execute();
  const text = prefillText(token);
  return { id, token, link: `https://wa.me/${number}?text=${encodeURIComponent(text)}`, text, secret, expiresAt };
}

export type JoinPollResult =
  | { status: "pending" }
  | { status: "ok"; phone: string }
  | { status: "mismatch" }
  | { status: "expired" };

/**
 * The starting browser's poll. Another browser (no secret, or another one)
 * is told "expired" like a row that never existed. A message from any number
 * but the typed one consumes the row and answers `mismatch`. `ok` is single
 * use: the row is claimed in one conditional update.
 */
export async function pollJoinPhoneLink(id: string, inviteId: string, secret: string): Promise<JoinPollResult> {
  const { db } = await getDatabase();
  const row = await db.selectFrom("login_codes").selectAll().where("id", "=", id).where("kind", "=", KIND).executeTakeFirst();
  const prefix = `${JOIN_PREFIX}${inviteId}:${hashSecret(secret)}:`;
  if (!row || !row.trip_id?.startsWith(prefix) || row.consumed_at) return { status: "expired" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { status: "expired" };
  if (!row.link_consumed_at || !row.email) return { status: "pending" };
  const typed = row.trip_id.slice(prefix.length);
  const sender = row.email.replace(/\D/g, "");
  const taken = await db
    .updateTable("login_codes")
    .set({ consumed_at: new Date().toISOString() })
    .where("id", "=", row.id)
    .where("consumed_at", "is", null)
    .executeTakeFirst();
  if (Number(taken.numUpdatedRows ?? 0) !== 1) return { status: "expired" };
  return sender === typed && typed ? { status: "ok", phone: typed } : { status: "mismatch" };
}
