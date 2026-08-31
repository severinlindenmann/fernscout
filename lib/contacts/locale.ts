import { installedLocales } from "../locales";
import type { Locale } from "../types";

/**
 * Which language to open in.
 *
 * The whole point of the personal link (ROADMAP §3.1) is that the recipient
 * never sees a language picker: the language is baked into the token, so the
 * page is already in it. The open link has no token, so it falls back to
 * `?lang=`, then to what the browser asked for, then to the journal's own
 * default. A picker still exists on the form — but as a correction, not a
 * first step.
 */

export function parseLocale(value: string | null | undefined): Locale | null {
  if (typeof value !== "string") return null;
  const short = value.trim().slice(0, 2).toLowerCase();
  return (installedLocales() as string[]).includes(short) ? (short as Locale) : null;
}

/**
 * The best of the languages an `Accept-Language` header lists.
 *
 * Quality values are honoured because browsers really do send them, and a
 * Hungarian speaker with English as a fallback sends `hu,en;q=0.9` — taking
 * the first entry blindly happens to work there and fails the moment the order
 * is the other way round.
 */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      return { locale: parseLocale(tag), q: q === undefined ? 1 : Number(q) };
    })
    .filter((entry): entry is { locale: Locale; q: number } => entry.locale !== null)
    .filter((entry) => Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked[0]?.locale ?? null;
}

/** The first of the candidates that is a language this site speaks. */
export function pickLocale(...candidates: (string | null | undefined)[]): Locale {
  for (const candidate of candidates) {
    const locale = parseLocale(candidate);
    if (locale) return locale;
  }
  return "en";
}
