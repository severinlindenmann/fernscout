/**
 * One exact match against a comma-separated list of phrases — B1743.
 *
 * Lifted out of `lib/whatsapp/acknowledge.ts`, which had the only copy and is
 * now one of two callers: the web room needs the identical question ("did
 * they just type yes?") and two implementations of that is how they come to
 * disagree about the same word. Deliberately **not** `server-only` — the
 * second caller is `components/HelperAsk.tsx`, in a browser.
 *
 * **Trimmed, case-folded, exact, and nothing cleverer.** A person describing
 * their day might contain the word "yes" without meaning to agree to
 * anything, and a fuzzy match would read that as agreement.
 *
 * The phrases themselves live in `site/locales/*.json`, never in a `.ts`
 * file: a Hungarian word typed into source is a word nobody who reads
 * Hungarian is looking at when it is reviewed.
 */
export function matchesPhraseList(text: string, list: string): boolean {
  const said = text.trim().toLowerCase();
  if (said === "") return false;
  return phrasesOf(list).includes(said);
}

/**
 * The same list, matched against an emphatic spelling of the **first word**
 * — B1302's widening, kept as its own function since B1743.
 *
 * "jaa gerne" ("yes, gladly") is not the exact phrase and used to get total
 * silence; the fix was never to fuzzy-match a "yes" out of an ordinary
 * sentence, only to read an emphatic first word as the word it obviously is.
 * A first word with no repeated letters is compared as written, so "jamais"
 * never collapses into "ja" and stays a miss.
 *
 * **It is separate from `matchesPhraseList` because a press must not use
 * it.** Agreeing to a disclosure and pressing a write are not the same risk:
 * "ja aber erst den Titel ändern" — *yes, but change the title first* — is a
 * fair acknowledgement and a catastrophic press, since what it would write is
 * the version they just said was wrong. B1743 found this with a test rather
 * than in somebody's journal.
 */
export function matchesFirstWord(text: string, list: string): boolean {
  const firstWord = text.trim().toLowerCase().split(/\s+/)[0]?.replace(/[.,!?]+$/, "") ?? "";
  if (firstWord === "") return false;
  return phrasesOf(list).includes(firstWord.replace(/(.)\1+/g, "$1"));
}

function phrasesOf(list: string): string[] {
  return list
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word !== "");
}
