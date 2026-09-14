import "server-only";
import { translateIn } from "../locales";
import { matchesFirstWord, matchesPhraseList } from "../phrases";

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
  // Both halves live in `../phrases` since B1743 — the exact list and
  // B1302's emphatic-first-word collapse, which used to be written out a
  // second time here. They are two functions rather than one flag because
  // `components/HelperAsk.tsx`'s typed press may only ever have the first:
  // "ja aber erst den Titel ändern" is a fair acknowledgement and a
  // catastrophic press.
  const list = translateIn(locale, "wa.yes");
  return matchesPhraseList(text, list) || matchesFirstWord(text, list);
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
  return matchesPhraseList(text, translateIn(locale, key));
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
