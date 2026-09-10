import "server-only";
import { translateIn } from "../locales";

/**
 * Whether one message counts as agreeing to the AI/consent disclosure the
 * first reply carries — B1138.
 *
 * **Case-insensitive, trimmed, exact match, and nothing cleverer.** A person
 * describing their day might contain the word "yes" without meaning to
 * consent to anything, and a fuzzy match would read that as the
 * acknowledgement — the guard AGENTS.md warns against firing on an honest
 * turn, one level down: matching too eagerly here is not a false refusal but
 * a false *grant*, which is worse.
 *
 * The words themselves live in `site/locales/*.json` under `wa.yes`, a
 * comma-separated list, rather than here — the same reason every other piece
 * of this channel's copy is a translation key and not a string in `lib/`:
 * a Hungarian word typed into a `.ts` file is a word nobody who reads
 * Hungarian is looking at when it is reviewed.
 */
export function isAcknowledgement(text: string, locale: string): boolean {
  if (matchesPhrase(text, locale, "wa.yes")) return true;
  /**
   * A narrow widening, not a loosened match — B1302, scenario-margrit.md
   * finding 4. "jaa gerne" ("yes, gladly") is not the exact phrase and got
   * total silence; the fix is not fuzzy-matching a "yes" out of an ordinary
   * sentence (the exact list above is still the whole grant), only reading
   * an emphatic spelling of the *first word* as the word it obviously is —
   * "jaa" collapses to "ja", "yesss" collapses to "yes". A first word with no
   * repeated letters is compared as written, so "jamais" never collapses
   * into "ja" and stays a miss.
   */
  const firstWord = text.trim().toLowerCase().split(/\s+/)[0]?.replace(/[.,!?]+$/, "") ?? "";
  if (firstWord === "") return false;
  const collapsed = firstWord.replace(/(.)\1+/g, "$1");
  const phrases = translateIn(locale, "wa.yes")
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word !== "");
  return phrases.includes(collapsed);
}

/** The shared matcher: trimmed, case-folded, exact, against a comma-separated
 *  list of phrases in one translation key — B1138's discipline, generalised
 *  for B1245's "new chat" command so the two never drift into two different
 *  ideas of what an exact match means. */
function matchesPhrase(
  text: string,
  locale: string,
  key: Parameters<typeof translateIn>[1],
): boolean {
  const said = text.trim().toLowerCase();
  if (said === "") return false;
  const phrases = translateIn(locale, key)
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word !== "");
  return phrases.includes(said);
}

/**
 * "new chat" / "neues gespräch" — B1245.
 *
 * The same exact-match discipline as `isAcknowledgement`: a sentence about
 * their day that happens to contain these words is not the command, so this
 * is matched trimmed, case-folded and whole against `wa.newChat`, sourced
 * from `site/locales/*.json` exactly as `wa.yes` is.
 */
export function isNewChatCommand(text: string, locale: string): boolean {
  return matchesPhrase(text, locale, "wa.newChat");
}
