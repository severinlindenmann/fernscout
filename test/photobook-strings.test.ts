import { describe, expect, test } from "vitest";
import { bookStrings, fill, isBookLocale } from "@/lib/photobook/strings";

/**
 * The book's own vocabulary, held to the same standard as the site's.
 *
 * `test/locales.test.ts` does this for `content/locales/*.json`; the book keeps
 * its words in `lib/photobook/strings.ts` instead, for the reason stated at the
 * top of that file, so it needs its own parity check or the second and third
 * languages quietly fall behind the first.
 */

const LOCALES = ["en", "de", "hu"] as const;
const MODES = ["flight", "train", "bus", "car", "motorbike", "boat", "walk"];

describe("the book's words", () => {
  test("every language has every key", () => {
    const english = bookStrings("en");
    for (const locale of LOCALES) {
      const table = bookStrings(locale);
      expect(Object.keys(table).sort(), locale).toEqual(Object.keys(english).sort());
      for (const [key, value] of Object.entries(table)) {
        if (typeof value === "string") expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  test("every language names every way of travelling", () => {
    for (const locale of LOCALES) {
      const table = bookStrings(locale);
      for (const mode of MODES) {
        expect(table.modeVerb[mode], `${locale} verb ${mode}`).toBeTruthy();
        expect(table.modeOne[mode], `${locale} one ${mode}`).toBeTruthy();
        expect(table.modeMany[mode], `${locale} many ${mode}`).toBeTruthy();
      }
    }
  });

  test("a placeholder in one language is a placeholder in all of them", () => {
    // A translation that drops `{count}` prints a sentence with a number
    // missing from it, which reads as a bug in the book rather than in the
    // translation.
    const english = bookStrings("en");
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const locale of LOCALES) {
      const table = bookStrings(locale);
      for (const [key, value] of Object.entries(english)) {
        if (typeof value !== "string") continue;
        const mine = table[key as keyof typeof table];
        expect(placeholders(mine as string), `${locale}.${key}`).toBe(placeholders(value));
      }
    }
  });

  test("an unknown language is English rather than an empty book", () => {
    expect(bookStrings("fr")).toBe(bookStrings("en"));
    expect(isBookLocale("fr")).toBe(false);
    expect(isBookLocale("de")).toBe(true);
  });

  test("fill replaces what it knows and leaves what it does not", () => {
    expect(fill("{count} people", { count: "18" })).toBe("18 people");
    // A missing variable leaves the placeholder visible on the page, which is
    // ugly and findable. Substituting "undefined" would be neither.
    expect(fill("{count} people")).toBe("{count} people");
  });
});
