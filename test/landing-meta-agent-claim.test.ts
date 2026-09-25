import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dictionaryFor, installedLocales } from "@/lib/locales";

/**
 * B1949 — the title tag and the Open Graph description still said an agent
 * writes the journal, in all three languages, after the on-page copy was
 * corrected for B1947. They were left because they are not rendered on the
 * page — which is exactly why they are the version a stranger meets first,
 * in a search result and in an unfurled link.
 *
 * `landing-metadata.test.tsx` already proves the title and description come
 * from the dictionary in the reader's language; this proves the claim itself
 * changed, in the dictionary and in `app/opengraph-image.tsx`'s own text —
 * "you can write it yourself" now sits beside "or an agent", matching
 * `landing.hero`.
 */
describe("the meta title and description no longer claim only an agent writes the journal", () => {
  test.each(installedLocales())("%s: the title and description mention writing it yourself", (locale) => {
    const dict = dictionaryFor(locale);
    const title = dict["landing.metaTitle"];
    const description = dict["landing.metaDescription"];
    // Loosely: neither string may say "an agent" without also naming the
    // do-it-yourself half somewhere in the same sentence — checked by
    // requiring the human word ("you"/"yourself"/"du"/"dir"/"magad"/"te")
    // to appear at least once across the pair.
    const combined = `${title} ${description}`.toLowerCase();
    const selfWords = ["yourself", "you", "dir", "du", "magad", "te ", "tiéd"];
    expect(selfWords.some((w) => combined.includes(w))).toBe(true);
  });

  test("English no longer says only 'your agent writes'", () => {
    const dict = dictionaryFor("en");
    expect(dict["landing.metaTitle"]).not.toBe("{name} — a travel journal your agent writes");
    expect(dict["landing.metaDescription"]).not.toContain("write it through an agent");
    expect(dict["landing.metaDescription"]).toContain("yourself");
  });
});

describe("the Open Graph image's own line", () => {
  test("no longer claims an agent writes it for you", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/opengraph-image.tsx"),
      "utf-8",
    );
    expect(source).not.toContain("A travel journal your agent writes for you.");
    expect(source).toContain("you write yourself");
  });
});
