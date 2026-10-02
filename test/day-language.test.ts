import { describe, expect, test } from "vitest";
import { dayLanguageFor, offerLocalesFor } from "@/lib/studio/dayLanguage";

/**
 * B2700 — Preview's "Readers in X get the Y text" line and its translate
 * offer used to read the journal's `defaultLocale` for both, regardless of
 * what the day actually said: Ilona's Hungarian day in an English journal
 * told her readers "get the English text" and offered Hungarian back among
 * the "other" languages.
 */
describe("dayLanguageFor", () => {
  test("a saved language wins over everything else", () => {
    expect(dayLanguageFor("hu", "fr", "en")).toBe("hu");
  });

  test("a fresh compose result, not yet saved, is read when nothing is saved", () => {
    expect(dayLanguageFor(undefined, "hu", "en")).toBe("hu");
  });

  test("falls back to the journal's defaultLocale when neither is known", () => {
    expect(dayLanguageFor(undefined, undefined, "en")).toBe("en");
  });
});

describe("offerLocalesFor", () => {
  test("a day in the journal's own language is offered every OTHER locale, same as before", () => {
    expect(offerLocalesFor("en", "en", ["de", "hu"])).toEqual(["de", "hu"]);
  });

  test("a day in a non-default language is offered the journal's default too — never itself", () => {
    // Ilona's case: journal default "en", she also speaks "de"; her day is
    // Hungarian. She should be offered English and German, never Hungarian.
    expect(offerLocalesFor("hu", "en", ["de"])).toEqual(["en", "de"]);
  });

  test("never offers the day's own language even if it is also the journal default", () => {
    expect(offerLocalesFor("en", "en", ["de"])).not.toContain("en");
  });
});
