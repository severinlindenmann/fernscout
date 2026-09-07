import { describe, expect, test } from "vitest";
import {
  BASE_RAPPEN_PER_CREDIT,
  DISCOUNT_FROM,
  creditWorth,
  creditsInRappen,
  formatChf,
  priceRappen,
} from "@/lib/credits/pricing";
import { dictionaryFor, installedLocales } from "@/lib/locales";
import { translate } from "@/lib/i18n";

/**
 * What a credit is worth, said once — B806.
 *
 * A 71-year-old tester was offered a button that would have spent one credit,
 * could find nothing anywhere saying what a credit is, and put the phone down.
 * The thing she was declining cost about twenty rappen. B767 was right to take
 * prices off the first screen; the *unit* still has to be explainable at the
 * moment somebody is asked to spend one.
 *
 * The property worth holding: every figure in that sentence comes out of
 * the price function. A price typed into a locale file is a price that will be wrong the
 * day the table changes, in three languages at once, with nothing failing.
 */

describe("the credit sentence", () => {
  test("every figure in it is arithmetic on the price function", () => {
    const worth = creditWorth();
    expect(worth.one).toBe(formatChf(creditsInRappen(1)));
    expect(worth.one).toBe(formatChf(BASE_RAPPEN_PER_CREDIT));
    expect(worth.credits).toBe(String(DISCOUNT_FROM));
    expect(worth.price).toBe(formatChf(priceRappen(DISCOUNT_FROM)));
  });

  test("no language has the price typed into it", () => {
    for (const locale of installedLocales()) {
      const template = dictionaryFor(locale)["credits.worth"];
      expect(template, locale).toBeTypeOf("string");
      for (const slot of ["{one}", "{credits}", "{price}"]) {
        expect(template, `${locale} is missing ${slot}`).toContain(slot);
      }
      // No figure of any kind: the price function is the only source of one.
      expect(template, locale).not.toMatch(/\d/);
    }
  });

  test("it says something in every language, with the numbers filled in", () => {
    for (const locale of installedLocales()) {
      const said = translate(dictionaryFor(locale), "credits.worth", creditWorth());
      expect(said, locale).toContain(formatChf(creditsInRappen(1)));
      expect(said, locale).toContain(String(DISCOUNT_FROM));
      expect(said, locale).toContain(formatChf(priceRappen(DISCOUNT_FROM)));
    }
  });
});
