import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider, { useI18n } from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { MAINTAINED_LOCALES } from "@/lib/i18n";
import type { Entry } from "@/lib/types";

/**
 * B305 — a reader shown a day in a language they did not ask for is told,
 * once, on the day itself.
 *
 * This is a legacy-only path (B294 refuses a new day missing a declared
 * language at the door), so the day here carries no `translations` at all —
 * exactly the shape a pre-B294 day has.
 *
 * Mirrors `UpdateBlock`'s own render condition (`fallbackNotice && …`) rather
 * than rendering `StoryPager` itself, which needs a `TripProvider` this test
 * has no reason to stand up.
 */

const UNTRANSLATED = {
  slug: "day",
  title: "Original title",
  content: "Original content.",
} as unknown as Entry;

function Probe({ entry }: { entry: Entry }) {
  const { localized, t } = useI18n();
  const { title, fallbackNotice } = localized(entry);
  return (
    <div>
      <h2>{title}</h2>
      {fallbackNotice && <p data-fallback-notice>{t(fallbackNotice)}</p>}
    </div>
  );
}

function read(locale: string, writtenLocale: string, entry: Entry): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)} writtenLocale={writtenLocale}>
      <Probe entry={entry} />
    </LocaleProvider>,
  );
}

describe("the fallback notice", () => {
  test("a reader on the language the day was written in sees nothing new", () => {
    for (const locale of MAINTAINED_LOCALES) {
      const html = read(locale, locale, UNTRANSLATED);
      expect(html, locale).not.toContain("data-fallback-notice");
    }
  });

  test("a reader on a locale the day does not carry sees the notice once, in their own language", () => {
    const expectedByReaderThenSource: Record<string, Record<string, string>> = {
      en: { de: "Written in German", hu: "Written in Hungarian", fr: "Written in French", it: "Written in Italian" },
      de: {
        en: "Auf Englisch geschrieben",
        hu: "Auf Ungarisch geschrieben",
        fr: "Auf Französisch geschrieben",
        it: "Auf Italienisch geschrieben",
      },
      hu: { de: "Németül íródott", en: "Angolul íródott", fr: "Franciául íródott", it: "Olaszul íródott" },
      fr: { en: "Écrit en anglais", de: "Écrit en allemand", hu: "Écrit en hongrois", it: "Écrit en italien" },
      it: { en: "Scritto in inglese", de: "Scritto in tedesco", hu: "Scritto in ungherese", fr: "Scritto in francese" },
    };

    for (const reader of MAINTAINED_LOCALES) {
      for (const source of MAINTAINED_LOCALES) {
        if (source === reader) continue;
        const html = read(reader, source, UNTRANSLATED);
        expect(html, `${reader} reading a ${source} day`).toContain('data-fallback-notice');
        expect(html, `${reader} reading a ${source} day`).toContain(
          expectedByReaderThenSource[reader][source],
        );
        // Exactly one notice, not one per something else on the page.
        expect(html.match(/data-fallback-notice/g)?.length, `${reader}/${source}`).toBe(1);
      }
    }
  });

  // B2700 — a day carries its own `language`, separate from the journal's
  // `defaultLocale` (`writtenLocale` here). Ilona wrote her day in Hungarian
  // in an English-default journal; a Hungarian reader of her own words was
  // told "Written in English" because the fallback read the *journal's*
  // language rather than the day's.
  test("a day with its own language is read against that language, not the journal's", () => {
    const hungarianDay = { ...UNTRANSLATED, language: "hu" } as Entry;

    // The Hungarian reader reads her own language: no notice at all.
    const own = read("hu", "en", hungarianDay);
    expect(own).not.toContain("data-fallback-notice");

    // An English reader of the journal (its own default) sees the day is in
    // Hungarian — not "written in English", which the journal-wide default
    // used to claim about every day regardless of what it actually said.
    const english = read("en", "en", hungarianDay);
    expect(english).toContain("data-fallback-notice");
    expect(english).toContain("Written in Hungarian");

    // A day with no `language` of its own still falls back to the journal's
    // default exactly as before.
    const noLanguage = read("de", "en", UNTRANSLATED);
    expect(noLanguage).toContain("Auf Englisch geschrieben");
  });
});
