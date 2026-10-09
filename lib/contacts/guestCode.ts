import "server-only";
import { isEmail, issueCode, revokeCodes, spendCode, verifyCode } from "../auth";
import { isEnabled } from "../capabilities";
import { subjectPhone } from "../phone";
import { emailCodeAllowed } from "../rateLimit";
import type { Locale } from "../types";
import { getUser } from "../users";
import {
  getContact,
  getContactByEmail,
  markContactPhoneProven,
  normaliseEmail,
  setContactLocaleIfEmpty,
  setProvenEmail,
  type ContactRecord,
} from "./index";
import { pickLocale, fromAcceptLanguage } from "./locale";
import { sendCodeMail } from "./mail";
import { maskEmail } from "./welcome";

/**
 * A guest proves who they are with a code to their email — B2294 (B2291,
 * "Proving a person"). B2597: readers sign in by email only; the mobile
 * channel (a guest code texted to a proven number, and the join link's own
 * first-phone path) is gone, along with SMS day announcements and invites —
 * no plan sends a reader an SMS any more.
 *
 * A `guest` code row (`issueCode`) whose subject is the address. Redeeming
 * it opens the same `fs_session` and `fs_identity` an emailed code always
 * did, and every gate finds the contact behind that subject through
 * `subjectLookup`. Nothing here grants anything: a proved address opens
 * exactly what its contact has been let into.
 */

type GuestCodeChannel = "email";

export type SendGuestCodeResult =
  /** `to` is masked — safe to show on a page that anyone holding a link sees. */
  | { ok: true; channel: GuestCodeChannel; to: string }
  | {
      ok: false;
      /**
       * - `no_contact`: no such contact here, or one the owner blocked.
       * - `no_channel`: the contact has no address to sign in with.
       * - `unavailable`: this server cannot send mail.
       * - `rate_limited`: too many codes to this address, or on this
       *   instance. Nothing was issued; a code already held lives.
       * - `send_failed`: the send threw. The code it wrote was taken back.
       */
      reason: "no_contact" | "no_channel" | "unavailable" | "rate_limited" | "send_failed";
    };

/**
 * Send this contact a guest sign-in code by email — the only channel left
 * (B2597).
 *
 * Issuing supersedes whatever code the subject held (`issueCode`), so every
 * refusal is decided **before** anything is written.
 */
export async function sendGuestCode(
  owner: string,
  contactId: string,
  options: { ip: string; locale?: Locale | null; destination?: string | null },
): Promise<SendGuestCodeResult> {
  const user = getUser(owner);
  const contact = user ? await getContact(owner, contactId) : null;
  if (!user || !contact || contact.status === "blocked") return { ok: false, reason: "no_contact" };
  const subject = contact.email.includes("@") ? contact.email : null;
  if (!subject) return { ok: false, reason: "no_channel" };
  // Reader chain: the language asked for now, else the contact's own, else
  // en — never the journal's default. Nothing is persisted here: a code
  // request proves nothing, so "last used" is written on redeem instead.
  const locale = pickLocale(options.locale ?? contact.locale);

  if (!isEnabled("mail")) return { ok: false, reason: "unavailable" };
  if (!emailCodeAllowed(subject)) return { ok: false, reason: "rate_limited" };

  const { code, linkToken } = await issueCode(owner, subject, "guest", {
    destination: options.destination ?? null,
  });
  try {
    // B2366 — a contact already `active` (Add a person pre-approves on the
    // spot, and Let in on a /j/ request activates it too) has nothing left
    // waiting on the owner; "Nothing opens yet" is only true for the ordinary
    // `pending` row still asking.
    await sendCodeMail(owner, user, subject, locale, code, linkToken, contact.status === "active");
  } catch (err) {
    console.error(`[contacts] guest code for ${owner} could not be sent:`, err);
    await revokeCodes(owner, subject, "guest").catch(() => {});
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true, channel: "email", to: maskEmail(subject) ?? subject };
}

/**
 * The subject an email-proof code is issued under — bound to one contact and
 * never a sign-in subject, so no sign-in door can spend it.
 */
function emailProofSubject(contactId: string, email: string): string {
  return `proof:${contactId}:${email}`;
}

/**
 * B2293: a **signed-in** contact with no email address adds one by proving it
 * — the welcome guide's "Is this right?" screen. **`contactId` MUST come from
 * `journalReader(username)`**, never from the request. Mails the typed
 * address a code bound to that contact; `confirmEmailProof` redeems it.
 */
export async function sendEmailProof(
  owner: string,
  contactId: string,
  raw: string,
  options: { locale?: Locale | null },
): Promise<{ ok: true; to: string } | { ok: false; reason: "no_contact" | "invalid_email" | "unavailable" | "rate_limited" | "send_failed" }> {
  const user = getUser(owner);
  const contact = user ? await getContact(owner, contactId) : null;
  if (!user || !contact || contact.status === "blocked") return { ok: false, reason: "no_contact" };
  const email = normaliseEmail(raw);
  if (!isEmail(email)) return { ok: false, reason: "invalid_email" };
  if (!isEnabled("mail")) return { ok: false, reason: "unavailable" };
  if (!emailCodeAllowed(email)) return { ok: false, reason: "rate_limited" };
  const subject = emailProofSubject(contact.id, email);
  const { code } = await issueCode(owner, subject, "guest");
  try {
    await sendCodeMail(owner, user, email, pickLocale(options.locale ?? contact.locale), code, null);
  } catch (err) {
    console.error(`[contacts] email proof for ${owner} could not be sent:`, err);
    await revokeCodes(owner, subject, "guest").catch(() => {});
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true, to: maskEmail(email) ?? email };
}

/**
 * Redeem `sendEmailProof`'s code and make the address this contact's. False on
 * any failure alike — including an address another contact holds.
 * **`contactId` MUST come from `journalReader(username)`.** Opens no session.
 */
export async function confirmEmailProof(owner: string, contactId: string, raw: string, code: string): Promise<boolean> {
  const email = normaliseEmail(raw);
  const contact = await getContact(owner, contactId);
  if (!contact || contact.status === "blocked" || !isEmail(email)) return false;
  const holder = await getContactByEmail(owner, email);
  if (holder && holder.id !== contact.id) return false;
  const spent = await spendCode(owner, emailProofSubject(contact.id, email), code, "guest");
  if (!spent.ok) return false;
  return setProvenEmail(owner, contact.id, email);
}

export type GuestSession = {
  /** The `fs_session` token — set it with `setGuestSessionCookies`. */
  token: string;
  expiresAt: string;
  /** The address that was proved. */
  subject: string;
  /** The contact behind it here, if any. Its access is still asked at every
   * request (`journalReader`, `isPersonOn`); this is for the caller's page. */
  contact: ContactRecord | null;
};

/**
 * Redeem a guest code for a session — the one `verifyCode` every other guest
 * code goes through, so single use, five wrong guesses and the code window
 * hold here unchanged. Null on every failure, alike.
 */
export async function verifyGuestCode(
  owner: string,
  subject: string,
  code: string,
  /** The redeeming request's Accept-Language — "last used" (W44 D7), written
   * only now that the code proved this is the contact, and only when the
   * contact has no language yet. */
  acceptLanguage?: string | null,
): Promise<GuestSession | null> {
  const result = await verifyCode(owner, subject, code, "guest");
  if (!result.ok) return null;
  // B-2942: a code texted to a number proves it; stamp it on its contact.
  const digits = subjectPhone(result.email);
  if (digits) await markContactPhoneProven(owner, digits);
  const contact = await getContactByEmail(owner, result.email);
  if (contact && acceptLanguage) await setContactLocaleIfEmpty(owner, contact.id, fromAcceptLanguage(acceptLanguage));
  return {
    token: result.token,
    expiresAt: result.expiresAt,
    subject: result.email,
    contact,
  };
}
