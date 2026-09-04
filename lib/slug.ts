/**
 * One slug, from a title or a place name.
 *
 * A slug is the permanent half of a permalink. It is what gets shared, and
 * renaming it later breaks whatever was shared — so the rule that produces it
 * has to be the same rule no matter which door the day came in by. There used
 * to be two of these functions, one in `lib/api/entries.ts` and one in
 * `lib/ingest/entry.ts`, and they disagreed: "Ærøskøbing" was `aeroskobing`
 * through photo ingest and `r-sk-bing` through the API. Same title, two
 * permanent URLs (B77). This is the only one.
 *
 * Pure on purpose — no fs, no `server-only`. The REST route and
 * `npm run ingest` both call it, and the latter runs under plain `node`,
 * which is why every import of this file names the `.ts` extension.
 */

/**
 * Letters that must be spelled out before the accents come off.
 *
 * The pass below decomposes with NFD and drops the combining marks, which is
 * right for French and Vietnamese — "Hội An" keeps its vowels and becomes
 * `hoi-an`. It is wrong for the letters here, which are not an ASCII letter
 * plus an accent but letters in their own right. Without this table "Ðà Lạt"
 * slugs to `a-lat` and "Ærøskøbing" to `rskbing`, which is the sort of URL
 * you only notice after it has been shared.
 *
 * ## The rule, because no rule is right in every language
 *
 * A slug function is handed a string and no language tag, so each codepoint
 * gets exactly one mapping and some reader somewhere is disappointed by it.
 * The rule picked here, applied by the shape of the letter rather than by the
 * language it was probably written in:
 *
 *  - **A vowel carrying a diaeresis expands to vowel + `e`** — `ä ö ü` become
 *    `ae oe ue`. This is the German rule, and it is the one that keeps two
 *    different words apart: without it "Rückfahrt" (a return journey) slugs
 *    to `ruckfahrt`, and *Ruck* is a jolt. A Swede would write "Malmö" as
 *    `malmo` and gets `malmoe` instead, which is ungainly but still reads as
 *    Malmö. The other way round loses the word.
 *  - **A letter whose two-letter form is its own name keeps it** — `æ œ ß þ`
 *    become `ae oe ss th`.
 *  - **Everything else goes to the nearest single ASCII letter** — `ø å đ ð
 *    ł` become `o a d d l`. The ring on `å` is not a diaeresis, so the
 *    Danish `aa` is not what this produces; `ø` was already `o` before B77
 *    and slugs exist under that spelling.
 *
 * Consistency is what matters here, not being right in every language: the
 * same title has to produce the same slug through every door, for ever.
 */
const TRANSLITERATIONS: [RegExp, string][] = [
  [/[äÄ]/g, "ae"],
  [/[öÖ]/g, "oe"],
  [/[üÜ]/g, "ue"],
  [/[æÆ]/g, "ae"],
  [/[œŒ]/g, "oe"],
  [/[þÞ]/g, "th"],
  [/ß/g, "ss"],
  // Both the Vietnamese d-with-stroke and the eth GeoNames often uses for it.
  [/[đĐðÐ]/g, "d"],
  [/[øØ]/g, "o"],
  [/[łŁ]/g, "l"],
];

/** Combining marks: U+0300–U+036F, which is where NFD leaves an accent. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * A slug is one path segment, so it is also a filename. Sixty characters is
 * long enough for any real title and short enough to stay readable in a URL.
 */
export const SLUG_MAX_LENGTH = 60;

/** What a title with no ASCII left in it is called. */
export const SLUG_FALLBACK = "entry";

export function slugify(text: string): string {
  // Compose first. The table matches whole letters, and macOS hands over
  // filenames already decomposed — a "ü" read off a memory card is `u` plus a
  // combining diaeresis, which no entry above would match and NFD below would
  // silently reduce to `u`. Both spellings have to slug the same.
  let out = text.normalize("NFC");
  for (const [pattern, replacement] of TRANSLITERATIONS) out = out.replace(pattern, replacement);
  return (
    out
      .toLowerCase()
      // Now the accents, and only the accents: "Hội An" becomes "hoi-an"
      // rather than losing the vowels entirely.
      .normalize("NFD")
      .replace(COMBINING_MARKS, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX_LENGTH)
      // Trimmed twice: the cut above can land on a hyphen, and a slug that
      // ends in one is not the shape the rest of the codebase expects.
      .replace(/-+$/, "") || SLUG_FALLBACK
  );
}
