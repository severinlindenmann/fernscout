import "server-only";
import crypto from "node:crypto";
import { hashSecret } from "../auth";
import { hasSwitchedOff, isEnabled } from "../capabilities";
import { balanceOf, creditsEnabled, refund, spend } from "../credits";
import { formatChf } from "../creditsFormat";
import { creditsInRappen } from "@paid/credits/lib/credits/pricing";
import { getDatabase, getDatabaseOrNull, newId, nowIso } from "../db";
import { translateIn } from "../locales";
import { mailDisabledReason } from "../mail";
import { toE164 } from "../phone";
import { rateLimitFor } from "../rateLimit";
import { serverSite } from "../site";
import { sendSms, smsUnreachable } from "../sms";
import { getTrip, tripRef } from "../trips";
import type { Locale } from "../types";
import { getUser } from "../users";
import { whatsappCountryCode } from "../contactNumber";
import { sendWhatsapp } from "@paid/whatsapp/lib/whatsapp/index";
import { inviteTemplateFor } from "@paid/whatsapp/lib/whatsapp/settings";
import { decryptString, encryptString, hasContactsKey } from "./crypto";
import { approveContact, confirmContactByOwner, getContact, type ContactRecord } from "./index";
import { parseLocale, pickLocale } from "./locale";
import { sendWelcomeMail } from "./mail";

/**
 * The welcome link and the four ways an owner tells somebody about it — B2292
 * (B2291 "Links", "Credits").
 *
 * **The link grants nothing.** `/w/<code>` opens a guide whose next step sends
 * a code to the channel the owner typed; the person is in only once they
 * prove that channel. A leaked or forwarded link costs at most a first name
 * and the journal's title. That is why the code may sit in a path and in a
 * text message at all (B1970 option (a)).
 *
 * One code per contact, stored as a sha-256 (for `/w/` lookup — unique across
 * the instance, since the path names no journal) and an AES-256-GCM copy, so
 * the owner can copy the same link again (the B280 shape). Ten characters
 * from a 31-letter alphabet with no look-alikes, ≈ 50 bits.
 */

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_LENGTH = 10;
const WELCOME_CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

function newCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/** Its own prefix, for the reason `inviteAad` gives. */
function welcomeAad(owner: string, contactId: string): string {
  return `welcome:${owner}:${contactId}`;
}

function welcomeUrl(code: string): string {
  return `${serverSite().url.replace(/\/$/, "")}/w/${code}`;
}

/**
 * This contact's welcome code: the stored one, or — only when there has never
 * been one — a fresh one. **A code is never replaced here**: a link already
 * sent keeps working. Null when a code exists but cannot be read back (no
 * contacts key, so only its hash was kept): the link was shown once, and the
 * caller says so rather than silently minting another (security review L3).
 *
 * The first mint is a conditional update on `welcome_code_hash is null`, so
 * two presses at once agree on one code.
 */
export async function welcomeCodeFor(owner: string, contactId: string): Promise<string | null> {
  const { db } = await getDatabase();
  const read = () =>
    db
      .selectFrom("contacts")
      .select(["welcome_code_hash", "welcome_code_cipher"])
      .where("owner_id", "=", owner)
      .where("id", "=", contactId)
      .executeTakeFirst();
  const kept = (row: Awaited<ReturnType<typeof read>>) =>
    row?.welcome_code_cipher
      ? decryptString(row.welcome_code_cipher, welcomeAad(owner, contactId), "invite token")
      : null;

  const row = await read();
  if (!row) return null;
  if (row.welcome_code_hash) return kept(row);

  const code = newCode();
  const minted = await db
    .updateTable("contacts")
    .set({
      welcome_code_hash: hashSecret(code),
      welcome_code_cipher: hasContactsKey() ? encryptString(code, welcomeAad(owner, contactId)) : null,
      updated_at: nowIso(),
    })
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .where("welcome_code_hash", "is", null)
    .executeTakeFirst();
  // bigint on both dialects — `Number()`, as `spend` does.
  if (Number(minted.numUpdatedRows ?? 0) === 1) return code;
  return kept(await read());
}

/**
 * Who a welcome code belongs to — nothing more. Null for an unknown code and
 * for a blocked contact (taking access away takes the welcome with it). The
 * caller renders a greeting; it must not open a session or read a grant.
 */
export async function resolveWelcomeCode(
  code: string,
): Promise<{ owner: string; contact: ContactRecord } | null> {
  if (!WELCOME_CODE_RE.test(code)) return null;
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("contacts")
    .select(["owner_id", "id"])
    .where("welcome_code_hash", "=", hashSecret(code))
    .executeTakeFirst();
  if (!row) return null;
  const contact = await getContact(row.owner_id, row.id);
  if (!contact || contact.status === "blocked") return null;
  return { owner: row.owner_id, contact };
}

/** The first open of the welcome link. Leaves an earlier stamp alone. */
export async function markWelcomeOpened(owner: string, contactId: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ welcome_opened_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .where("welcome_opened_at", "is", null)
    .execute();
}

// ─── Join codes (B2293) ────────────────────────────────────────────────────

/** Its own prefix, so a welcome cipher can never be read as a join one. */
function joinAad(owner: string, inviteId: string): string {
  return `join:${owner}:${inviteId}`;
}

export function joinUrl(code: string): string {
  return `${serverSite().url.replace(/\/$/, "")}/j/${code}`;
}

/**
 * A group link's `/j/<code>` — the stored one, or, only when there has never
 * been one, a fresh one; the same rules as `welcomeCodeFor`. Null for a code
 * that exists but cannot be read back (no contacts key), and for an unknown
 * invite.
 */
export async function joinCodeFor(owner: string, inviteId: string): Promise<string | null> {
  const { db } = await getDatabase();
  const read = () =>
    db
      .selectFrom("contact_invites")
      .select(["join_code_hash", "join_code_cipher"])
      .where("owner_id", "=", owner)
      .where("id", "=", inviteId)
      .executeTakeFirst();
  const kept = (row: Awaited<ReturnType<typeof read>>) =>
    row?.join_code_cipher ? decryptString(row.join_code_cipher, joinAad(owner, inviteId), "invite token") : null;

  const row = await read();
  if (!row) return null;
  if (row.join_code_hash) return kept(row);
  const code = newCode();
  const minted = await db
    .updateTable("contact_invites")
    .set({
      join_code_hash: hashSecret(code),
      join_code_cipher: hasContactsKey() ? encryptString(code, joinAad(owner, inviteId)) : null,
    })
    .where("owner_id", "=", owner)
    .where("id", "=", inviteId)
    .where("join_code_hash", "is", null)
    .executeTakeFirst();
  if (Number(minted.numUpdatedRows ?? 0) === 1) return code;
  return kept(await read());
}

export type JoinInvite = {
  owner: string;
  id: string;
  kind: "guest" | "buddy" | "personal";
  tripId: string | null;
  locale: Locale | null;
  /** The address a mailed invite named (B319) — pre-approval, compared
   * against a proved address, never shown. */
  emailKey: string | null;
};

/**
 * Which live group link a join code names — nothing more. Null for an
 * unknown, revoked or expired link, alike. The caller renders a form; the
 * link itself grants nothing.
 */
export async function resolveJoinCode(code: string): Promise<JoinInvite | null> {
  if (!WELCOME_CODE_RE.test(code)) return null;
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("contact_invites")
    .select(["owner_id", "id", "kind", "trip_id", "locale", "revoked_at", "expires_at", "email_key"])
    .where("join_code_hash", "=", hashSecret(code))
    .executeTakeFirst();
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  const kind = row.kind === "guest" || row.kind === "buddy" ? row.kind : "personal";
  return {
    owner: row.owner_id,
    id: row.id,
    kind,
    tripId: kind === "buddy" ? row.trip_id : null,
    locale: parseLocale(row.locale),
    emailKey: row.email_key,
  };
}

/** The guide runs once (B2293). Leaves an earlier stamp alone. */
export async function markOnboarded(owner: string, contactId: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ onboarded_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .where("onboarded_at", "is", null)
    .execute();
}

// ─── Channels ──────────────────────────────────────────────────────────────

export type InviteChannel = "email" | "whatsapp" | "sms" | "self";
export const INVITE_CHANNELS: readonly InviteChannel[] = ["email", "whatsapp", "sms", "self"];

/** Why a channel cannot be used for this person, or null when it can. */
type ChannelBlock =
  | "no_email"
  | "no_mobile"
  | "mail_off"
  | "whatsapp_off"
  | "sms_off"
  | "unreachable"
  /** The link was shown once and this server kept only its hash (no
   * contacts key): there is nothing to send or copy, and it is not quietly
   * replaced (L3). */
  | "link_lost";

/** The trip a buddy was added to — the newest place they hold or asked for. */
async function buddyTripTitle(owner: string, contactId: string): Promise<string | null> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("trip_people")
    .select("trip_id")
    .where("owner_id", "=", owner)
    .where("contact_id", "=", contactId)
    .where("revoked_at", "is", null)
    .orderBy("requested_at", "desc")
    .executeTakeFirst();
  if (!row) return null;
  return getTrip(tripRef(owner, row.trip_id))?.title ?? null;
}

function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * At most `max` characters, "..." when cut — security review L2. Every
 * variable in a text message is capped, so one credit buys one message of a
 * few SMS segments rather than two dozen; ASCII so the ending does not force
 * a whole text into UCS-2.
 */
export function capText(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3).trimEnd()}...`;
}

/** How the owner is named to somebody else: nickname, or first name — never
 * the full name (I3). */
export function ownerShortName(user: { owner: { nickname?: string; name: string } }): string {
  return user.owner.nickname?.trim() || firstName(user.owner.name);
}

/** Meta rejects a body parameter with a newline, a tab or four spaces in a row. */
function asParameter(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 300) || "-";
}

type Message = {
  locale: Locale;
  url: string;
  /** Filling the WhatsApp template's four variables, in order. */
  params: [string, string, string, string];
  /** The whole message, as the person reads it on every channel. */
  text: string;
  /** The mail's subject line. */
  subject: string;
};

async function messageFor(owner: string, contact: ContactRecord, code: string): Promise<Message | null> {
  const user = getUser(owner);
  if (!user) return null;
  const locale = pickLocale(contact.locale, user.defaultLocale);
  const trip = await buddyTripTitle(owner, contact.id);
  const url = welcomeUrl(code);
  const vars = {
    name: capText(firstName(contact.name), 40),
    owner: capText(ownerShortName(user), 40),
    title: capText(trip ?? user.title, 60),
    url,
  };
  return {
    locale,
    url,
    params: [vars.name, vars.owner, vars.title, vars.url],
    text: translateIn(locale, trip ? "welcomeLink.textBuddy" : "welcomeLink.textReader", vars),
    subject: translateIn(locale, "welcomeLink.mailSubject", vars),
  };
}

function smsDigits(contact: ContactRecord): string | null {
  return contact.phone ? toE164(contact.phone, whatsappCountryCode()) : null;
}

function blockFor(owner: string, contact: ContactRecord, channel: InviteChannel): ChannelBlock | null {
  if (channel === "self") return null;
  if (channel === "email") {
    if (!contact.email.includes("@")) return "no_email";
    return mailDisabledReason(owner) ? "mail_off" : null;
  }
  const digits = smsDigits(contact);
  if (channel === "whatsapp") {
    if (!isEnabled("whatsapp") || hasSwitchedOff("whatsapp", owner)) return "whatsapp_off";
    return digits ? null : "no_mobile";
  }
  if (!isEnabled("sms")) return "sms_off";
  if (!digits) return "no_mobile";
  return smsUnreachable(digits) ? "unreachable" : null;
}

/** What one message on this channel costs — 1 credit for WhatsApp and SMS
 * where this instance charges at all (D5), nothing otherwise. */
function costOf(channel: InviteChannel): number {
  return (channel === "whatsapp" || channel === "sms") && creditsEnabled() ? 1 : 0;
}

export type InviteOptions = {
  contactId: string;
  name: string | null;
  /** Null when the link cannot be shown again (`link_lost`). */
  url: string | null;
  /** Masked, for "to +41 •••• 12". */
  to: { email: string | null; mobile: string | null };
  channels: { channel: InviteChannel; cost: number; blocked: ChannelBlock | null; preview: string }[];
  /** Null when credits are switched off on this instance. */
  balance: number | null;
  /** What one credit is worth ("CHF 0.20"), from the pricing module — null
   * where this build has no price for one. */
  creditPrice: string | null;
  /** True once the person opened their link: sending again is no longer offered. */
  opened: boolean;
};

function maskEmail(email: string): string | null {
  if (!email.includes("@")) return null;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}•••@${domain}`;
}

function maskMobile(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits.length < 4) return null;
  return `+${digits.slice(0, 2)} ${"•".repeat(Math.max(1, digits.length - 4))} ${digits.slice(-2)}`;
}

/**
 * Step 2's model: every channel, whether it can be used and why not, what it
 * costs, and exactly the text the person would get on it. Null for a contact
 * that is not this owner's, or not let in.
 */
export async function inviteOptions(owner: string, contactId: string): Promise<InviteOptions | null> {
  const contact = await getContact(owner, contactId);
  if (!contact || !invitable(contact)) return null;
  const code = await welcomeCodeFor(owner, contactId);
  const message = code ? await messageFor(owner, contact, code) : null;
  if (code && !message) return null;
  return {
    contactId,
    name: contact.name,
    url: message?.url ?? null,
    to: { email: maskEmail(contact.email), mobile: maskMobile(contact.phone) },
    channels: INVITE_CHANNELS.map((channel) => ({
      channel,
      cost: costOf(channel),
      blocked: message ? blockFor(owner, contact, channel) : "link_lost",
      preview: !message ? "" : channel === "self" ? message.url : message.text,
    })),
    balance: await balanceOf(owner),
    creditPrice: creditsInRappen(1) > 0 ? formatChf(creditsInRappen(1)) : null,
    opened: contact.welcomeOpenedAt !== null,
  };
}

/** Three sends an hour per person, across every channel — a resend button is
 * not a way to flood somebody's phone. `self` sends nothing and is not counted. */
const SEND_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };
/** And fifty a day per journal, across everybody (L4): a journal is not a
 * bulk sender, and a stolen owner cookie must not be one either. */
const DAILY_LIMIT = { max: 50, windowMs: 24 * 60 * 60 * 1000 };

export type InviteSendResult =
  | {
      ok: true;
      channel: InviteChannel;
      url: string;
      /** The transport that took it: `dry-run` / `file` / `console` wrote it
       * locally and nothing left this machine; anything else accepted it for
       * delivery. Null for `self`, which sends nothing. */
      backend: string | null;
      charged: number;
      balance: number | null;
    }
  | {
      ok: false;
      reason:
        | "no_contact"
        | "already_opened"
        | "rate_limited"
        | "daily_limit"
        | "no_credits"
        | "send_failed"
        | ChannelBlock;
      balance?: number | null;
    };

/**
 * Tell this person about their welcome link on one channel — the owner's
 * press, and the only thing here that sends or charges.
 *
 * WhatsApp and SMS take one credit before the message leaves and give it back
 * when the send throws; a short balance sends nothing and charges nothing.
 * Email is free and never touches the ledger. `self` sends nothing and
 * returns the link. Offered only while the link has not been opened.
 */
export async function sendInvite(
  owner: string,
  contactId: string,
  channel: InviteChannel,
): Promise<InviteSendResult> {
  const contact = await getContact(owner, contactId);
  if (!contact || !invitable(contact)) return { ok: false, reason: "no_contact" };
  const code = await welcomeCodeFor(owner, contactId);
  if (!code) return { ok: false, reason: "link_lost" };
  const message = await messageFor(owner, contact, code);
  if (!message) return { ok: false, reason: "no_contact" };

  if (channel === "self") {
    await letInImported(owner, contact);
    await recordInvited(owner, contactId, "self");
    return { ok: true, channel, url: message.url, backend: null, charged: 0, balance: await balanceOf(owner) };
  }
  if (contact.welcomeOpenedAt) return { ok: false, reason: "already_opened" };
  const blocked = blockFor(owner, contact, channel);
  if (blocked) return { ok: false, reason: blocked };
  if (!rateLimitFor("invite-send", `${owner}:${contactId}`, SEND_LIMIT).ok) {
    return { ok: false, reason: "rate_limited" };
  }
  if (!rateLimitFor("invite-send-journal", owner, DAILY_LIMIT).ok) return { ok: false, reason: "daily_limit" };

  const cost = costOf(channel);
  const ref = `invite/${contactId}/${newId()}`;
  if (!(await spend(owner, cost, "invite", ref))) {
    return { ok: false, reason: "no_credits", balance: await balanceOf(owner) };
  }

  let backend: string | null = null;
  try {
    backend = await deliver(owner, contact, channel, message);
  } catch (err) {
    console.error(`[invite] ${channel} to contact ${contactId} failed:`, err instanceof Error ? err.message : err);
  }
  if (backend === null) {
    // Nothing went out: whatever it cost comes back.
    if (cost > 0) await refund(owner, cost, ref);
    return { ok: false, reason: "send_failed", balance: await balanceOf(owner) };
  }

  await letInImported(owner, contact);
  await recordInvited(owner, contactId, channel);
  return { ok: true, channel, url: message.url, backend, charged: cost, balance: await balanceOf(owner) };
}

/**
 * Who step 2 may be offered for: somebody the owner let in (`active`), or —
 * B2291 D2 — a person an import filed under "Not invited yet", who has not
 * asked anything and been asked nothing. A request somebody made through a
 * link (`pending`, not imported) is never here: that is the owner's Let in /
 * Decline, not an invitation to send.
 */
function invitable(contact: ContactRecord): boolean {
  return contact.status === "active" || (contact.status === "pending" && contact.createdVia === "owner-import");
}

/**
 * Inviting an imported person is the owner pre-approving them — B2291 D2,
 * the same chain `addPersonByOwner` runs: vouch for the channel, then
 * approve with **no** trip place (an imported name is a byline, never write
 * access). Only after something was actually sent (or the owner took the
 * link to share it), so a failed send leaves them where they were.
 */
async function letInImported(owner: string, contact: ContactRecord): Promise<void> {
  if (contact.status !== "pending") return;
  await confirmContactByOwner(owner, contact.id);
  await approveContact(owner, contact.id, { onlyTrip: null });
}

/** The send itself. The backend's name, or null when the channel turned out
 * to be off after all (a switch flipped between the check and the send). */
async function deliver(
  owner: string,
  contact: ContactRecord,
  channel: Exclude<InviteChannel, "self">,
  message: Message,
): Promise<string | null> {
  if (channel === "email") {
    const user = getUser(owner);
    if (!user) return null;
    const sent = await sendWelcomeMail(owner, user, contact, message);
    return sent?.transport ?? null;
  }
  const to = smsDigits(contact);
  if (!to) return null;
  if (channel === "sms") return (await sendSms({ to, body: message.text })).backend;
  const template = inviteTemplateFor(message.locale);
  const sent = await sendWhatsapp({
    to,
    template: template.name,
    language: template.language,
    body: message.params.map(asParameter),
    username: owner,
    // Something the owner asked to send one person they named — Meta's
    // utility category. B2298 registers the template.
    category: "utility",
  });
  return sent?.backend ?? null;
}

async function recordInvited(owner: string, contactId: string, channel: InviteChannel): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ invited_via: channel, invited_at: nowIso(), updated_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .execute();
}

/**
 * The owner let this person in (B2291 "Group-link visitor"): tell them on the
 * channel they proved — email when their address is confirmed, otherwise an
 * SMS to a number they proved. Free either way (a transactional note, like a
 * code; D4). The message carries their welcome link. Returns the channel that
 * took it, or null when there was nothing to send on — never throws: the
 * approval already stands.
 */
export async function tellLetIn(owner: string, contact: ContactRecord): Promise<"email" | "sms" | null> {
  const user = getUser(owner);
  const code = user ? await welcomeCodeFor(owner, contact.id) : null;
  if (!user || !code) return null;
  const locale = pickLocale(contact.locale, user.defaultLocale);
  const url = welcomeUrl(code);
  const vars = {
    name: capText(firstName(contact.name), 40),
    owner: capText(ownerShortName(user), 40),
    title: capText(user.title, 60),
    url,
  };
  const text = translateIn(locale, "welcomeLink.letInText", vars);
  try {
    if (contact.email.includes("@") && contact.confirmedAt && !mailDisabledReason(owner)) {
      const subject = translateIn(locale, "welcomeLink.letInSubject", vars);
      if (await sendWelcomeMail(owner, user, contact, { locale, url, text, subject })) return "email";
    }
    const digits = contact.phoneProvenAt ? smsDigits(contact) : null;
    if (digits && isEnabled("sms") && !smsUnreachable(digits)) {
      await sendSms({ to: digits, body: text });
      return "sms";
    }
  } catch (err) {
    console.error(`[invite] telling contact ${contact.id} they are in failed:`, err instanceof Error ? err.message : err);
  }
  return null;
}
