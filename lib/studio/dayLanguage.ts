/**
 * The main part's own language, and which of the journal's other languages
 * to offer translating it into — B2700.
 *
 * Before this ticket, Preview always read the journal's own `defaultLocale`
 * for both: a day written in a different language than the journal (compose
 * detects and sets `language`) was told readers "get the English text" and
 * offered to translate into the journal's other languages including the one
 * it was actually written in.
 */

/** What is already saved on the day, else what this visit's own compose
 * detected (not yet saved), else the journal's `defaultLocale` — the same
 * fallback order a published day reads with (`LocaleProvider.localized`). */
export function dayLanguageFor(saved: string | undefined, composed: string | undefined, defaultLocale: string): string {
  return saved || composed || defaultLocale;
}

/** The journal's whole locale list (`defaultLocale` plus `otherLocales`,
 * `user.locales` minus `defaultLocale`), re-filtered against the day's own
 * language — so a day written in a non-default language is offered every
 * OTHER language the journal has, `defaultLocale` included, not "every
 * language but the journal's own". */
export function offerLocalesFor(dayLanguage: string, defaultLocale: string, otherLocales: string[]): string[] {
  return Array.from(new Set([defaultLocale, ...otherLocales])).filter((l) => l !== dayLanguage);
}
