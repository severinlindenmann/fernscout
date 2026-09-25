import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B470, finishing B225's job — a translated page needs translated metadata.
 *
 * A static `metadata` export cannot see the request, so it cannot see the
 * locale. On a page whose body is translated that produces the failure B225
 * recorded on the landing page: a German reader gets an English browser tab,
 * an English search result and an English link preview above a German page.
 * It is invisible from inside the page, which is why it survived a review.
 *
 * The rule is only about pages that *are* translated. `/docs/hosting`,
 * `/docs/contributing` and `/docs/api` are English by decision — the hub says
 * so in the reader's own language — so a static English title on them is
 * correct rather than a slip, and they are excluded by name.
 */
const TRANSLATED_PAGES = ["app/docs/page.tsx", "app/docs/guide/[guide]/page.tsx"];

/** English by decision — see the note above. */
const ENGLISH_PAGES = [
  "app/docs/hosting/page.tsx",
  "app/docs/contributing/page.tsx",
  "app/docs/api/page.tsx",
];

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("metadata follows the language of the page", () => {
  test.each(TRANSLATED_PAGES)("%s asks the request for a locale", (file) => {
    const src = read(file);
    expect(src).toContain("generateMetadata");
    expect(src).toContain("requestLocale");
    // A static export beside it would win for whichever fields it sets.
    expect(src).not.toMatch(/export const metadata\s*:/);
  });

  test.each(ENGLISH_PAGES)("%s may keep a static English title", (file) => {
    // Asserted rather than merely allowed, so that deleting the hub's
    // "in English" label without revisiting these pages fails here.
    expect(read(file)).toMatch(/export const metadata\s*:/);
  });

  test("the hub's description is a dictionary key in every language", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    for (const locale of ["en", "de", "hu"]) {
      expect(dictionaryFor(locale)["docs.lede"], locale).toBeTruthy();
    }
    expect(read("app/docs/page.tsx")).not.toContain(
      "How to use, host and contribute to this journal.",
    );
  });
});
