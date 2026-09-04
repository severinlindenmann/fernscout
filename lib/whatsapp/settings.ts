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
