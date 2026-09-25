import "server-only";
import { CODE_TTL_MINUTES, issueCode, resolveSession, revokeCodes, revokeSession, verifyCode } from "../auth";
import { isEnabled } from "../capabilities";
import { whatsappCountryCode } from "../contactNumber";
import { translateIn } from "../locales";
import { maskNumber, phoneSubject, subjectPhone, toE164 } from "../phone";
import { emailCodeAllowed, firstPhoneCodeAllowed, smsCodeAllowed } from "../rateLimit";
import { sendSms, smsUnreachable } from "../sms";
import type { Locale } from "../types";
import { getUser } from "../users";
import {
  addContactWithProvenPhone,
  getContact,
  getContactByEmail,
  markContactPhoneProven,
  setProvenPhone,
  type ContactRecord,
} from "./index";
import { pickLocale } from "./locale";
import { sendCodeMail } from "./mail";

/**
 * A guest proves who they are with a code to their email **or** their mobile
 * number — B2294 (B2291, "Proving a person").
 *
 * Both channels end in the same place: an ordinary `guest` code row
 * (`issueCode`) whose subject is the address, or the number as
 * `+<digits>` (`phoneSubject`). Redeeming it opens the same `fs_session` and
 * `fs_identity` an emailed code does, and every gate finds the contact behind
 * either subject through `subjectLookup`. Nothing here grants anything: a
 * proved number opens exactly what its contact has been let into.
 *
 * SMS codes are free to the owner (B2291 D4) — nothing here touches
 * `lib/credits.ts` — and are rate-limited per number, per IP and per
 * instance (`smsCodeAllowed`).
 */

export type GuestCodeChannel = "email" | "sms";

export type SendGuestCodeResult =
  /** `to` is masked — safe to show on a page that anyone holding a link sees. */
  | { ok: true; channel: GuestCodeChannel; to: string }
  | {
      ok: false;
      /**
       * - `no_contact`: no such contact here, or one the owner blocked.
       * - `no_channel`: the contact has no address (email) or no number that
       *   is theirs to sign in with (sms — none, not international, or held by
       *   another contact of this journal).
       * - `unavailable`: this server cannot send on that channel (mail/sms
       *   off, or the number's country is outside the SMS sender's reach).
       * - `rate_limited`: too many codes to this number/address, from this IP,
       *   or on this instance. Nothing was issued; a code already held lives.
       * - `send_failed`: the send threw. The code it wrote was taken back.
       */
      reason: "no_contact" | "no_channel" | "unavailable" | "rate_limited" | "send_failed";
    };

/**
 * The sign-in subject a contact proves on one channel, or null when the
 * contact has nothing to prove there. A number counts only while it is the
 * one this contact is found by — see `phoneColumns` in `./index.ts`.
 */
async function guestSubject(
  owner: string,
  contact: ContactRecord,
  channel: GuestCodeChannel,
): Promise<string | null> {
  if (channel === "email") return contact.email.includes("@") ? contact.email : null;
  // Toll fraud (B2294's review): a text costs money, so only a contact the
  // owner let in or added themselves is ever texted — never a row somebody
  // made for themselves through a link and is still waiting.
  if (!textable(contact)) return null;
  const digits = contact.phone ? toE164(contact.phone, whatsappCountryCode()) : null;
  if (!digits) return null;
  const subject = phoneSubject(digits);
  return (await getContactByEmail(owner, subject))?.id === contact.id ? subject : null;
}

/**
 * Send one contact a guest sign-in code on the channel asked for.
 *
 * Issuing supersedes whatever code the subject held (`issueCode`), so every
 * refusal is decided **before** anything is written.
 */
export async function sendGuestCode(
  owner: string,
  contactId: string,
  channel: GuestCodeChannel,
  options: { ip: string; locale?: Locale | null; destination?: string | null },
): Promise<SendGuestCodeResult> {
  const user = getUser(owner);
  const contact = user ? await getContact(owner, contactId) : null;
  if (!user || !contact || contact.status === "blocked") return { ok: false, reason: "no_contact" };
  const subject = await guestSubject(owner, contact, channel);
  if (!subject) return { ok: false, reason: "no_channel" };
  const locale = pickLocale(options.locale ?? contact.locale, user.defaultLocale);
  const digits = subjectPhone(subject);

  if (digits) {
    if (!isEnabled("sms") || smsUnreachable(digits)) return { ok: false, reason: "unavailable" };
    if (!smsCodeAllowed(digits, options.ip)) return { ok: false, reason: "rate_limited" };
  } else {
    if (!isEnabled("mail")) return { ok: false, reason: "unavailable" };
    if (!emailCodeAllowed(subject)) return { ok: false, reason: "rate_limited" };
  }

  if (digits) {
    if (!(await textCode(owner, user.title, digits, locale, options.destination))) {
      return { ok: false, reason: "send_failed" };
    }
    return { ok: true, channel, to: maskNumber(digits) };
  }
  const { code, linkToken } = await issueCode(owner, subject, "guest", {
    destination: options.destination ?? null,
  });
  try {
    await sendCodeMail(owner, user, subject, locale, code, linkToken);
  } catch (err) {
    console.error(`[contacts] guest code for ${owner} could not be sent (${channel}):`, err);
    await revokeCodes(owner, subject, "guest").catch(() => {});
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true, channel, to: maskEmail(subject) };
}

/** Who may be texted at all: an active contact, or one the owner added. */
function textable(contact: ContactRecord): boolean {
  return contact.status === "active" || (contact.status === "pending" && (contact.createdVia ?? "").startsWith("owner"));
}

/**
 * Issue a guest code for `+<digits>` and text it. Every refusal has been
 * decided by the caller; a failed send takes the code back.
 */
async function textCode(
  owner: string,
  title: string,
  digits: string,
  locale: string,
  destination?: string | null,
): Promise<boolean> {
  const subject = phoneSubject(digits);
  const { code } = await issueCode(owner, subject, "guest", { destination: destination ?? null });
  try {
    await sendSms({
      to: digits,
      body: translateIn(locale, "contact.smsCodeBody", { code, title, minutes: CODE_TTL_MINUTES }),
    });
    return true;
  } catch (err) {
    console.error(`[contacts] sms code for ${owner} could not be sent:`, err);
    await revokeCodes(owner, subject, "guest").catch(() => {});
    return false;
  }
}

export type PhoneProofResult =
  | { ok: true; to: string }
  | { ok: false; reason: "no_contact" | "invalid_phone" | "unavailable" | "rate_limited" | "send_failed" };

/** The number as E.164 digits, and whether this server can text it. */
function textableNumber(raw: string): { digits: string } | { reason: "invalid_phone" | "unavailable" } {
  const digits = toE164(raw, whatsappCountryCode());
  if (!digits) return { reason: "invalid_phone" };
  if (!isEnabled("sms") || smsUnreachable(digits)) return { reason: "unavailable" };
  return { digits };
}

/**
 * B2294 (b): a **signed-in** contact adds a mobile number by proving it.
 *
 * `contactId` must come from the caller's own session (`journalReader`),
 * never from a request body — that is what makes the proved number theirs.
 * Texts the typed number a code; `confirmPhoneProof` redeems it.
 */
export async function sendPhoneProof(
  owner: string,
  contactId: string,
  phone: string,
  options: { ip: string; locale?: Locale | null },
): Promise<PhoneProofResult> {
  const user = getUser(owner);
  const contact = user ? await getContact(owner, contactId) : null;
  if (!user || !contact || !textable(contact)) return { ok: false, reason: "no_contact" };
  const number = textableNumber(phone);
  if (!("digits" in number)) return { ok: false, reason: number.reason };
  if (!smsCodeAllowed(number.digits, options.ip)) return { ok: false, reason: "rate_limited" };
  const locale = pickLocale(options.locale ?? contact.locale, user.defaultLocale);
  if (!(await textCode(owner, user.title, number.digits, locale))) return { ok: false, reason: "send_failed" };
  return { ok: true, to: maskNumber(number.digits) };
}

/**
 * Redeem the code `sendPhoneProof` texted, and make the number this
 * contact's sign-in number, proved. The session `verifyCode` opens for the
 * number is revoked: the caller is already signed in. False on any failure.
 */
export async function confirmPhoneProof(
  owner: string,
  contactId: string,
  phone: string,
  code: string,
): Promise<boolean> {
  const digits = toE164(phone, whatsappCountryCode());
  if (!digits) return false;
  const result = await verifyCode(owner, phoneSubject(digits), code, "guest");
  if (!result.ok) return false;
  const session = await resolveSession(result.token, "guest");
  if (session) await revokeSession(session.id);
  await setProvenPhone(owner, contactId, phone.trim());
  return true;
}

/**
 * B2294 (c): a code to a number a visitor typed as their **first** channel
 * — the join link. Texted whether or not a contact holds the number, so the
 * answer says nothing about who is on the journal; its own tight buckets
 * (`firstPhoneCodeAllowed`) keep it from being a way to spend the
 * instance's texts or to block anybody else's sign-in.
 */
export async function sendFirstPhoneCode(
  owner: string,
  phone: string,
  options: { ip: string; locale?: Locale | null },
): Promise<PhoneProofResult> {
  const user = getUser(owner);
  if (!user) return { ok: false, reason: "no_contact" };
  const number = textableNumber(phone);
  if (!("digits" in number)) return { ok: false, reason: number.reason };
  if (!firstPhoneCodeAllowed(number.digits, options.ip)) return { ok: false, reason: "rate_limited" };
  const locale = pickLocale(options.locale ?? null, user.defaultLocale);
  if (!(await textCode(owner, user.title, number.digits, locale))) return { ok: false, reason: "send_failed" };
  return { ok: true, to: maskNumber(number.digits) };
}

/**
 * Redeem `sendFirstPhoneCode`'s code. The number is proved, so: the contact
 * that already holds it, stamped proven — or a new `pending` contact created
 * by this proof, with nothing granted. Returns the guest session for the
 * number (set it with `setGuestSessionCookies`), or null on any failure.
 */
export async function proveFirstPhone(
  owner: string,
  phone: string,
  code: string,
  details: { name: string; locale: Locale; createdVia: string },
): Promise<(GuestSession & { contact: ContactRecord }) | null> {
  const digits = toE164(phone, whatsappCountryCode());
  if (!digits) return null;
  const session = await verifyGuestCode(owner, phoneSubject(digits), code);
  if (!session) return null;
  if (session.contact) return { ...session, contact: session.contact };
  const created = await addContactWithProvenPhone(owner, { ...details, phone: phone.trim() });
  if (!created.ok) return null;
  return { ...session, contact: created.contact };
}

export type GuestSession = {
  /** The `fs_session` token — set it with `setGuestSessionCookies`. */
  token: string;
  expiresAt: string;
  /** The address or `+<digits>` that was proved. */
  subject: string;
  /** The contact behind it here, if any. Its access is still asked at every
   * request (`journalReader`, `isPersonOn`); this is for the caller's page. */
  contact: ContactRecord | null;
};

/**
 * Redeem a guest code for a session — the one `verifyCode` every other guest
 * code goes through, so single use, five wrong guesses and the code window
 * hold here unchanged. A proved number is stamped `phone_proven_at` on its
 * contact. Null on every failure, alike.
 */
export async function verifyGuestCode(
  owner: string,
  subject: string,
  code: string,
): Promise<GuestSession | null> {
  const result = await verifyCode(owner, subject, code, "guest");
  if (!result.ok) return null;
  const digits = subjectPhone(result.email);
  if (digits) await markContactPhoneProven(owner, digits);
  return {
    token: result.token,
    expiresAt: result.expiresAt,
    subject: result.email,
    contact: await getContactByEmail(owner, result.email),
  };
}

/** `l•••@example.org` — enough for a person to recognise their own address. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}
