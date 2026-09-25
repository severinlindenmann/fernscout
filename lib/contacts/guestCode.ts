import "server-only";
import { CODE_TTL_MINUTES, issueCode, revokeCodes, verifyCode } from "../auth";
import { isEnabled } from "../capabilities";
import { whatsappCountryCode } from "../contactNumber";
import { translateIn } from "../locales";
import { maskNumber, phoneSubject, subjectPhone, toE164 } from "../phone";
import { emailCodeAllowed, smsCodeAllowed } from "../rateLimit";
import { sendSms, smsUnreachable } from "../sms";
import type { Locale } from "../types";
import { getUser } from "../users";
import { getContact, getContactByEmail, markContactPhoneProven, type ContactRecord } from "./index";
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
export async function guestSubject(
  owner: string,
  contact: ContactRecord,
  channel: GuestCodeChannel,
): Promise<string | null> {
  if (channel === "email") return contact.email.includes("@") ? contact.email : null;
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

  const { code, linkToken } = await issueCode(owner, subject, "guest", {
    destination: options.destination ?? null,
  });
  try {
    if (digits) {
      await sendSms({
        to: digits,
        body: translateIn(locale, "contact.smsCodeBody", {
          code,
          title: user.title,
          minutes: CODE_TTL_MINUTES,
        }),
      });
    } else {
      await sendCodeMail(owner, user, subject, locale, code, linkToken);
    }
  } catch (err) {
    console.error(`[contacts] guest code for ${owner} could not be sent (${channel}):`, err);
    await revokeCodes(owner, subject, "guest").catch(() => {});
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true, channel, to: digits ? maskNumber(digits) : maskEmail(subject) };
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
