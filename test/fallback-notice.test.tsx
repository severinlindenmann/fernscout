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
      en: { de: "Written in German", hu: "Written in Hungarian" },
      de: { en: "Auf Englisch geschrieben", hu: "Auf Ungarisch geschrieben" },
      hu: { de: "Németül íródott", en: "Angolul íródott" },
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
});
