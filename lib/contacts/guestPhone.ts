import "server-only";
import { issueCode, revokeCodes } from "../auth";
import { isEnabled } from "../capabilities";
import { loadServerConfig } from "../config";
import { whatsappCountryCode, whatsappNumberForUrl } from "../contactNumber";
import { translateIn } from "../locales";
import { isSwitchedOff } from "../messages/switches";
import { maskNumber, phoneSubject, toE164 } from "../phone";
import { smsJoinAllowed } from "../rateLimit";
import { serverSite } from "../site";
import { sendSms, smsUnreachable } from "../sms";
import { hasContactsKey } from "./crypto";
import { getContactByEmail } from "./index";

/**
 * A guest proves a mobile number through a reader link - B-2942, reversing
 * B2597 for sign-in codes only. Nothing here makes a number a notification
 * channel: day announcements to readers stay email and push.
 *
 * Two ways, one outcome (`app/j/[code]/step/route.ts` lets the person in):
 * an SMS code (`sendJoinSmsCode` + `verifyGuestCode` on the `+<digits>`
 * subject) or a WhatsApp message-in (`lib/phoneVerify/inboundLink.ts`, join
 * variant). Every limit fails closed.
 */

/** Countries a reader-link text may go to unless `features.sms.joinCountryCodes`
 * says otherwise: CH DE AT FR IT LI HU. */
const DEFAULT_COUNTRY_CODES = ["41", "49", "43", "33", "39", "423", "36"];

/** Calling codes (digits, no `+`) this instance texts reader-link codes to. */
function joinCountryCodes(): string[] {
  const configured = (loadServerConfig().features.sms as Record<string, unknown>).joinCountryCodes;
  if (!Array.isArray(configured)) return DEFAULT_COUNTRY_CODES;
  return configured.filter((c): c is string => typeof c === "string").map((c) => c.replace(/\D/g, "")).filter(Boolean);
}

export function joinCountryAllowed(digits: string): boolean {
  return joinCountryCodes().some((cc) => digits.startsWith(cc));
}

/** Whether the SMS option exists at all on this instance (and for the operator). */
export async function joinSmsAvailable(): Promise<boolean> {
  if (!isEnabled("sms") || !hasContactsKey() || joinCountryCodes().length === 0) return false;
  return !(await isSwitchedOff("code.sms"));
}

/** Whether the WhatsApp message-in option exists: sender, inbound webhook and
 * this instance's own number. */
export function joinWhatsappAvailable(): boolean {
  return isEnabled("whatsapp") && isEnabled("whatsappInbound") && hasContactsKey() && Boolean(whatsappNumberForUrl());
}

/** A number as typed, as E.164 digits, or null. */
export function typedDigits(raw: string): string | null {
  return toE164(raw, whatsappCountryCode());
}

type JoinSmsResult =
  | { ok: true; to: string }
  | { ok: false; reason: "unavailable" | "unsupported_country" | "rate_limited" | "send_failed" };

/**
 * Text a sign-in code to `digits` for a reader link. Every refusal is decided
 * before anything is issued; a failed send takes the code back. The code
 * text ends with the `@host #code` line so iOS offers it.
 */
export async function sendJoinSmsCode(
  owner: string,
  linkId: string,
  digits: string,
  options: { ip: string; locale: string; siteTitle: string },
): Promise<JoinSmsResult> {
  if (!(await joinSmsAvailable()) || smsUnreachable(digits)) return { ok: false, reason: "unavailable" };
  if (!joinCountryAllowed(digits)) return { ok: false, reason: "unsupported_country" };
  let host = "";
  try {
    host = new URL(serverSite().url).host;
  } catch {
    // no usable site url
  }
  if (!host) return { ok: false, reason: "unavailable" };
  if (!smsJoinAllowed(digits, options.ip, linkId)) return { ok: false, reason: "rate_limited" };

  const subject = phoneSubject(digits);
  const { code } = await issueCode(owner, subject, "guest");
  const body = translateIn(options.locale, "code.phoneVerify", { code, site: options.siteTitle, host });
  try {
    await sendSms({ to: digits, body, template: "code.sms", owner });
  } catch (err) {
    console.error(`[contacts] join sms code for ${owner} could not be sent (${maskNumber(digits)}):`, (err as Error).message);
    await revokeCodes(owner, subject, "guest").catch(() => {});
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true, to: maskNumber(digits) };
}

/**
 * A returning guest asks for a code to the number they signed in with
 * (`POST /api/auth/codes` with `phone`). Texted only when an active contact of
 * this journal holds that number; every other case does nothing, so the
 * caller answers the same 202 for any number. Same limits as the join link.
 */
export async function sendReturnSmsCode(
  owner: string,
  digits: string,
  options: { ip: string; locale: string; siteTitle: string },
): Promise<JoinSmsResult | { ok: false; reason: "no_contact" }> {
  const contact = await getContactByEmail(owner, phoneSubject(digits));
  if (!contact || contact.status !== "active") return { ok: false, reason: "no_contact" };
  return sendJoinSmsCode(owner, `return:${owner}`, digits, options);
}
