import { loadServerConfig } from "./config";
import { toE164 } from "./phone";

/**
 * The country code a national telephone number is assumed to belong to.
 *
 * Configured, never inferred — `lib/phone.ts` says at length why
 * guessing it is the one mistake in this module that hurts a stranger rather
 * than the operator. Absent means national numbers are simply not messageable,
 * which is the outcome that cannot send a family photograph to the wrong
 * person.
 *
 * Server-level rather than per-journal: it is a statement about where the
 * people filling in this instance's forms are standing, and an instance is
 * hosted once.
 */
export function whatsappCountryCode(): string | undefined {
  const configured = loadServerConfig().features.whatsapp.defaultCountryCode;
  return typeof configured === "string" && configured.trim() !== "" ? configured : undefined;
}

/**
 * This instance's own number, for a `wa.me` link — B1127.
 *
 * `features.whatsapp.number` in `site/config.json`, typed by an operator and
 * so in whatever shape a human writes a phone number — `+41 76 000 00 00`
 * with spaces, say, rather than bare digits, which is how the live
 * instance's own value was actually stored. Run through `toE164` (no
 * `defaultCountryCode`: an operator typing this field types it with a `+`,
 * and a national-format guess here would be guessing at the *operator's*
 * country rather than a contact's) so every `wa.me/<number>` link built
 * from this actually resolves. Absent, or not a
 * number `toE164` can make sense of, means the link simply is not rendered
 * anywhere, which is the outcome the owner chose over a broken chip: nothing
 * here guesses a number from the Cloud API credentials, because the phone
 * number id `WHATSAPP_PHONE_NUMBER_ID` names is not the dialable number
 * itself.
 */
export function whatsappNumberForUrl(): string | undefined {
  const configured = loadServerConfig().features.whatsapp.number;
  if (typeof configured !== "string" || configured.trim() === "") return undefined;
  return toE164(configured) ?? undefined;
}

export function whatsappNumberForDisplay(): string | undefined {
  const number = whatsappNumberForUrl();
  return number ? `+${number}` : undefined;
}
