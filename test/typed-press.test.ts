import { describe, expect, test } from "vitest";
import { matchesFirstWord, matchesPhraseList } from "@/lib/phrases";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1743 — typing "ja" under a card that asks a yes/no question.
 *
 * The web room had no typed press, so the word reached the model, which holds
 * no handle on the waiting proposal, and the honesty guard replaced the answer
 * with "nothing is waiting for a confirmation" — while the card was on screen.
 * `components/HelperAsk.tsx` now asks this same question before the request
 * goes out, against the journal's own `wa.yes` list.
 *
 * What is asserted here is the matcher and the words, which is where this can
 * silently regress: a locale losing its yes word turns the press back off in
 * that language and nothing else would notice.
 */

describe("the words that count as a press", () => {
  for (const locale of ["en", "de", "hu"] as const) {
    test(`${locale} has a yes list, and it matches`, () => {
      const list = dictionaryFor(locale)["wa.yes"];
      expect(list).toBeTruthy();
      const first = list.split(",")[0].trim();
      expect(matchesPhraseList(first, list)).toBe(true);
      expect(matchesPhraseList(first.toUpperCase(), list)).toBe(true);
      expect(matchesPhraseList(`  ${first} `, list)).toBe(true);
    });
  }

  test("the German and Hungarian words are the ones a person types", () => {
    expect(matchesPhraseList("ja", dictionaryFor("de")["wa.yes"])).toBe(true);
    expect(matchesPhraseList("igen", dictionaryFor("hu")["wa.yes"])).toBe(true);
    expect(matchesPhraseList("yes", dictionaryFor("en")["wa.yes"])).toBe(true);
  });

  test("an emphatic spelling does NOT press — B1302's widening is consent-only", () => {
    // `isAcknowledgement` still reads these as yes, and should: agreeing to a
    // disclosure and writing to somebody's journal are not the same risk.
    expect(matchesPhraseList("jaa", dictionaryFor("de")["wa.yes"])).toBe(false);
    expect(matchesFirstWord("jaa", dictionaryFor("de")["wa.yes"])).toBe(true);
  });

  /**
   * The half that matters more. A press writes, so matching too eagerly is a
   * false press rather than a false refusal — a sentence that merely contains
   * a yes must never reach the route.
   */
  test("an ordinary sentence containing a yes is not a press", () => {
    const de = dictionaryFor("de")["wa.yes"];
    expect(matchesPhraseList("ja aber erst den Titel ändern", de)).toBe(false);
    expect(matchesPhraseList("nein", de)).toBe(false);
    expect(matchesPhraseList("jamais", de)).toBe(false);
    expect(matchesPhraseList("", de)).toBe(false);
    const en = dictionaryFor("en")["wa.yes"];
    expect(matchesPhraseList("yes but make it private", en)).toBe(false);
    expect(matchesPhraseList("yesterday we walked to the lake", en)).toBe(false);
  });
});
