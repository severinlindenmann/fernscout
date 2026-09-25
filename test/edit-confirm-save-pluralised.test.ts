import { describe, expect, test } from "vitest";
import { plural } from "@/lib/i18n";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1880 — the change preview's commit button read "Save 1 changes" for
 * exactly one changed field, because `EditDay.tsx` built the label with
 * plain `t()` and a `{count}` var rather than the repository's own
 * count-aware `tn()`. Fixed by routing `edit.confirmSave.button` through
 * `tn()` (`components/LocaleProvider.tsx`'s own wrapper around `plural`,
 * exercised directly here) with a `.one` entry added to en and de.
 */

describe("edit.confirmSave.button — B1880's own count", () => {
  test("English: one change reads as one change, several changes stay plural", () => {
    const en = dictionaryFor("en");
    expect(plural(en, "edit.confirmSave.button", 1, { count: "1" })).toBe("Save 1 change");
    expect(plural(en, "edit.confirmSave.button", 2, { count: "2" })).toBe("Save 2 changes");
  });

  test("German: one change reads as one change, several changes stay plural", () => {
    const de = dictionaryFor("de");
    expect(plural(de, "edit.confirmSave.button", 1, { count: "1" })).toBe("1 Änderung speichern");
    expect(plural(de, "edit.confirmSave.button", 2, { count: "2" })).toBe("2 Änderungen speichern");
  });

  // Hungarian does not inflect after a number (`plural`'s own doc comment)
  // — its `.one` entry holds the same word as the plural, on purpose.
  test("Hungarian: the singular and plural entries read the same, by design", () => {
    const hu = dictionaryFor("hu");
    expect(plural(hu, "edit.confirmSave.button", 1, { count: "1" })).toBe("1 módosítás mentése");
    expect(plural(hu, "edit.confirmSave.button", 2, { count: "2" })).toBe("2 módosítás mentése");
  });
});
