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
import { getContact, type ContactRecord } from "./index";
import { pickLocale } from "./locale";
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
export const WELCOME_CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

function newCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/** Its own prefix, for the reason `inviteAad` gives. */
function welcomeAad(owner: string, contactId: string): string {
  return `welcome:${owner}:${contactId}`;
}

export function welcomeUrl(code: string): string {
  return `${serverSite().url.replace(/\/$/, "")}/w/${code}`;
}

/**
 * This contact's welcome code — the stored one, or a fresh one when there is
 * none yet (or it cannot be read back, which without a contacts key is every
 * time: the old link then stops working, and the new one is the only one).
 */
export async function welcomeCodeFor(owner: string, contactId: string): Promise<string> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .select(["welcome_code_cipher"])
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .executeTakeFirst();
  const kept = row?.welcome_code_cipher
    ? decryptString(row.welcome_code_cipher, welcomeAad(owner, contactId), "invite token")
    : null;
  if (kept) return kept;

  const code = newCode();
  await db
    .updateTable("contacts")
    .set({
      welcome_code_hash: hashSecret(code),
      welcome_code_cipher: hasContactsKey() ? encryptString(code, welcomeAad(owner, contactId)) : null,
      updated_at: nowIso(),
    })
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .execute();
  return code;
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

// ─── Channels ──────────────────────────────────────────────────────────────

export type InviteChannel = "email" | "whatsapp" | "sms" | "self";
export const INVITE_CHANNELS: readonly InviteChannel[] = ["email", "whatsapp", "sms", "self"];

/** Why a channel cannot be used for this person, or null when it can. */
type ChannelBlock = "no_email" | "no_mobile" | "mail_off" | "whatsapp_off" | "sms_off" | "unreachable";

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
    name: firstName(contact.name),
    owner: user.owner.nickname || user.owner.name,
    title: trip ?? user.title,
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
  url: string;
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
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
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
  if (!contact || contact.status !== "active") return null;
  const message = await messageFor(owner, contact, await welcomeCodeFor(owner, contactId));
  if (!message) return null;
  return {
    contactId,
    name: contact.name,
    url: message.url,
    to: { email: maskEmail(contact.email), mobile: maskMobile(contact.phone) },
    channels: INVITE_CHANNELS.map((channel) => ({
      channel,
      cost: costOf(channel),
      blocked: blockFor(owner, contact, channel),
      preview: channel === "self" ? message.url : message.text,
    })),
    balance: await balanceOf(owner),
    creditPrice: creditsInRappen(1) > 0 ? formatChf(creditsInRappen(1)) : null,
    opened: contact.welcomeOpenedAt !== null,
  };
}

/** Three sends an hour per person, across every channel — a resend button is
 * not a way to flood somebody's phone. `self` sends nothing and is not counted. */
const SEND_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };

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
  if (!contact || contact.status !== "active") return { ok: false, reason: "no_contact" };
  const code = await welcomeCodeFor(owner, contactId);
  const message = await messageFor(owner, contact, code);
  if (!message) return { ok: false, reason: "no_contact" };

  if (channel === "self") {
    await recordInvited(owner, contactId, "self");
    return { ok: true, channel, url: message.url, backend: null, charged: 0, balance: await balanceOf(owner) };
  }
  if (contact.welcomeOpenedAt) return { ok: false, reason: "already_opened" };
  const blocked = blockFor(owner, contact, channel);
  if (blocked) return { ok: false, reason: blocked };
  if (!rateLimitFor("invite-send", `${owner}:${contactId}`, SEND_LIMIT).ok) {
    return { ok: false, reason: "rate_limited" };
  }

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

  await recordInvited(owner, contactId, channel);
  return { ok: true, channel, url: message.url, backend, charged: cost, balance: await balanceOf(owner) };
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
