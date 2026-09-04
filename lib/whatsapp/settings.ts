import { loadServerConfig } from "../config";

/**
 * The country code a national telephone number is assumed to belong to.
 *
 * Configured, never inferred — `lib/whatsapp/phone.ts` says at length why
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
 * Which approved template announces a day in a given language.
 *
 * `features.whatsapp.templates` maps a locale to a template name, because
 * Meta treats a template's language as part of its identity: `de` and `en`
 * are two separate assets, each approved on its own. A locale nobody has a
 * template for falls back to the journal's own, rather than failing — a
 * French-speaking reader getting the German announcement is a smaller harm
 * than getting nothing, and the alternative is that adding a locale silently
 * stops the whole feature.
 *
 * ## Why the *name* is configuration and not a constant
 *
 * Because you will change the wording, and changing the wording means a new
 * template. Meta does not let an approved one be edited freely, and — this is
 * the part that cost a day here — **a deleted template's name is reserved for
 * 30 days.** Deleting `fernscout_day_published` to recreate it without a
 * footer produced `(#100/2388023)` on every attempt to create it again, with
 * no way to undo and no way to use the name until October. The recovery was
 * `fernscout_day_published_v2` and one line in `content/config.json`, which is
 * only cheap because the name lives there rather than in this file.
 *
 * So: **never delete a template to fix it. Create the next version under a
 * new name and repoint the config.** The old one costs nothing to leave
 * sitting there, and it keeps working until the new one is approved, which
 * means the wording can change with no window where announcements fail.
 */
export function templateFor(locale: string, fallbackLocale: string): { name: string; language: string } | null {
  const configured = loadServerConfig().features.whatsapp.templates;
  if (typeof configured !== "object" || configured === null) return null;
  const table = configured as Record<string, unknown>;

  const exact = table[locale];
  if (typeof exact === "string" && exact.trim() !== "") {
    return { name: exact, language: locale };
  }
  const fallback = table[fallbackLocale];
  if (typeof fallback === "string" && fallback.trim() !== "") {
    return { name: fallback, language: fallbackLocale };
  }
  return null;
}
