import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider, { useI18n } from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { Entry } from "@/lib/types";

/**
 * B294 — which language a day is read in, when it is not the one it was
 * written in.
 *
 * `localized()` used to short-circuit on `locale === "en"`, which is only
 * correct for a journal whose prose is English. viki's is German with
 * `defaultLocale: "de"`, so a reader who switched to English was handed
 * `entry.title` — the German — while `translations.en` sat in the file
 * unread. The switcher worked; the words behind it did not move.
 *
 * The shortcut is still there, because it saves a lookup for readers who
 * cannot benefit from one. It just compares against the right thing now.
 */

const DAY = {
  slug: "ankunft",
  title: "Ankunft in Bangkok",
  content: "Um halb sechs aufgewacht.",
  translations: {
    en: { title: "Arriving in Bangkok", content: "Woke at half five." },
  },
} as unknown as Entry;

function Probe({ entry }: { entry: Entry }) {
  const { localized } = useI18n();
  const { title, content } = localized(entry);
  return (
    <p>
      {title}
      {" / "}
      {content}
    </p>
  );
}

function read(locale: string, writtenLocale: string | undefined, entry: Entry): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)} writtenLocale={writtenLocale}>
      <Probe entry={entry} />
    </LocaleProvider>,
  );
}

describe("a German journal's day", () => {
  test("reads in English for an English reader", () => {
    const html = read("en", "de", DAY);
    expect(html).toContain("Arriving in Bangkok");
    expect(html).toContain("Woke at half five.");
    expect(html).not.toContain("Ankunft in Bangkok");
  });

  test("reads in German for a German reader, without looking anything up", () => {
    const html = read("de", "de", DAY);
    expect(html).toContain("Ankunft in Bangkok");
    expect(html).toContain("Um halb sechs aufgewacht.");
  });

  test("falls back to the written language where a translation is missing", () => {
    // A day written before B294 required every language still reads — in the
    // language it has, for everybody. The fallback stays a fallback.
    const html = read("hu", "de", DAY);
    expect(html).toContain("Ankunft in Bangkok");
  });
});

describe("an English journal's day", () => {
  const english = {
    slug: "arrival",
    title: "Arrival",
    content: "Landed late.",
    translations: { de: { title: "Ankunft", content: "Spät gelandet." } },
  } as unknown as Entry;

  test("still reads in German for a German reader", () => {
    const html = read("de", "en", english);
    expect(html).toContain("Ankunft");
    expect(html).toContain("Spät gelandet.");
  });

  test("and the default written locale is English, for every page outside a journal", () => {
    // Ninety-odd call sites render this provider without a journal to read a
    // language off — the landing page, the invite pages, every test. They get
    // the old behaviour exactly.
    const html = read("en", undefined, english);
    expect(html).toContain("Arrival");
    expect(html).toContain("Landed late.");
  });
});
