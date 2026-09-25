/**
 * A telephone number as WhatsApp wants it: E.164 digits, no `+`, no spaces.
 *
 * The numbers this reads were typed by hand into a guestbook box next to a
 * postal address (`PostalAddress.tel`), so they arrive as
 * `+41 76 000 00 00`, `0041 76 000 00 00`, `076 000 00 00` and worse. Meta
 * accepts only the first form's digits — `41760000000` — and answers anything
 * else with a delivery failure nobody sees, because a message to a wrong
 * number is accepted and then silently dropped.
 *
 * ## Why a national number is refused rather than guessed
 *
 * `076 000 00 00` is a Swiss number to a Swiss reader and an unroutable
 * string to everyone else. The leading zero is a *national* prefix whose
 * meaning depends on where the caller is standing, and this code is standing
 * on a server. Guessing it means picking a country for somebody, and picking
 * wrong sends a family photograph to a stranger who happens to hold that
 * number in another country — recoverable for us, not for them.
 *
 * So the guess has to be configured, never inferred: `defaultCountryCode`
 * under `features.whatsapp` is an operator saying "numbers on my instance
 * without a country are mine". With it absent, a national number is not
 * messageable and the contact is skipped, which is the outcome that cannot
 * hurt anybody.
 *
 * Deliberately not a full libphonenumber. That library exists because
 * *validating* a number properly needs every country's numbering plan; this
 * needs to recognise three prefixes and refuse the rest, and the failure mode
 * of being too strict is a contact who does not get a message.
 */
export function toE164(raw: string, defaultCountryCode?: string): string | null {
  // Everything a person uses to make a number readable, and nothing else:
  // a letter anywhere means this was not a number at all.
  const cleaned = raw.trim().replace(/[\s\-(). ‑-―]/g, "");
  if (cleaned === "") return null;

  let digits: string;
  if (cleaned.startsWith("+")) {
    digits = cleaned.slice(1);
  } else if (cleaned.startsWith("00")) {
    digits = cleaned.slice(2);
  } else if (cleaned.startsWith("0")) {
    // National form. Only a configured country code can rescue it.
    const cc = defaultCountryCode?.trim().replace(/^\+/, "");
    if (!cc || !/^\d{1,3}$/.test(cc)) return null;
    digits = cc + cleaned.slice(1);
  } else {
    // Already bare international, e.g. `41760000000`.
    digits = cleaned;
  }

  if (!/^\d+$/.test(digits)) return null;
  // E.164: at most 15 digits, and a country code plus a subscriber number is
  // never shorter than 8 in practice. Both ends are guards against a typo
  // becoming a message to somebody unrelated.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * Whether there is a number here worth trying — the `isPostable` of this
 * feature, and named to echo it.
 *
 * Consent without a reachable number is not consent to anything, the same way
 * `wantsPostcard` over an address with no street is a promise nobody can
 * keep. Both routes and UI ask this before offering the opt-in.
 */
export function isMessageable(tel: string | undefined, defaultCountryCode?: string): boolean {
  return typeof tel === "string" && toE164(tel, defaultCountryCode) !== null;
}

/**
 * A number with everything but its last four digits replaced.
 *
 * Logs go to the operator's journal and, on this instance, to stdout that
 * systemd keeps. A full number there is a personal detail of somebody who
 * gave it for postcards, sitting in a file nobody thinks of as containing
 * personal details — the same reasoning `features.logging` uses for never
 * recording an IP. Four digits is enough to tell two recipients apart while
 * reading a run.
 */
export function maskNumber(to: string): string {
  // Digits only, before anything else — this string is also used to build a
  // dry-run filename in three places (this module, lib/phoneVerify/dryRun.ts,
  // lib/whatsapp/reply.ts), two of which mask an inbound webhook's own `from`
  // field. A legitimate E.164 number is only ever digits, so this changes
  // nothing for the honest case and closes off a crafted value putting a `/`
  // or a `..` into the visible suffix a path gets built from.
  const digits = to.replace(/\D/g, "");
  return digits.length <= 4 ? "•".repeat(digits.length) : `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}
