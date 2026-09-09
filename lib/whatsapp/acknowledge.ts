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
  const said = text.trim().toLowerCase();
  if (said === "") return false;
  const words = translateIn(locale, "wa.yes")
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word !== "");
  return words.includes(said);
}
