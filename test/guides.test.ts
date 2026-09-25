import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GUIDES, isGuide, readGuide } from "@/lib/docs";

/**
 * B445 — the reader guides; today only `gps` (B2343). The guest, creator and
 * buddy guides were retired (`lib/docs.ts`), and with them the checks on
 * their figures and on what each had to cover.
 *
 * The content is prose and nothing here judges it. What is worth pinning is
 * the shape around it: that every guide exists in every language the site
 * offers, that a missing one degrades to English rather than to a crash, and
 * that the pages saying "not translated" cannot start lying because somebody
 * added a file without a string.
 */

const LOCALES = ["en", "de", "hu"];

/** One guide's markdown, in one language. */
const read = (locale: string, guide: string) =>
  fs.readFileSync(path.join(process.cwd(), `docs/guides/${locale}/${guide}.md`), "utf8");

describe("the guides exist", () => {
  test("every guide, in every language this site offers", () => {
    for (const locale of LOCALES) {
      for (const guide of GUIDES) {
        const file = path.join(process.cwd(), `docs/guides/${locale}/${guide}.md`);
        expect(fs.existsSync(file), `${locale}/${guide}.md`).toBe(true);
        // Not a stub. These are the pages a confused reader is sent to.
        expect(fs.readFileSync(file, "utf8").length).toBeGreaterThan(1500);
      }
    }
  });

  test("each one is read in the language asked for", () => {
    for (const locale of LOCALES) {
      for (const guide of GUIDES) {
        expect(readGuide(guide, locale).locale).toBe(locale);
      }
    }
  });

  /**
   * A missing translation must cost the reader the language, never the page —
   * and the caller has to be *told*, so the page can say so rather than
   * presenting English as though it were the translation.
   */
  test("an unknown language falls back to English, and says which it got", () => {
    const { markdown, locale } = readGuide("gps", "fr");
    expect(locale).toBe("en");
    expect(markdown.length).toBeGreaterThan(1500);
  });

  test("a guide with no copy at all throws rather than rendering empty", () => {
    // @ts-expect-error — deliberately outside the union, which is the case a
    // bad route param would produce if `isGuide` were ever dropped.
    expect(() => readGuide("nonesuch", "en")).toThrow();
  });
});

describe("the route only accepts the whitelist", () => {
  test("isGuide is the whitelist", () => {
    for (const guide of GUIDES) expect(isGuide(guide)).toBe(true);
    expect(isGuide("api")).toBe(false);
    // Retired, and redirected to the hub by `next.config.ts`.
    for (const retired of ["guest", "creator", "buddy"]) expect(isGuide(retired), retired).toBe(false);
    expect(isGuide("../../etc/passwd")).toBe(false);
    expect(isGuide("")).toBe(false);
  });

  /**
   * The path is built from the whitelist and the locale, and a reader
   * controls both. `isGuide` covers the first; this covers the second — a
   * locale is two letters by the time it reaches here, but the guide loader
   * would happily read `../../` if one ever were not.
   */
  test("a locale that is not two letters cannot become a path", () => {
    // Refused before it reaches `path.join`, rather than merely failing to
    // find a file — see the guard in `readGuide`.
    for (const bad of ["../../../etc", "en/../../..", "", "eng", "E N"]) {
      expect(readGuide("gps", bad).locale, bad).toBe("en");
    }
  });
});

/**
 * B449 — a translation that quietly loses a paragraph.
 *
 * The Hungarian guides were once translated from the German rather than from
 * the English, and inherited what the German had already dropped. Nothing
 * failed. Every existing check here is per-file —
 * a figure that is never referenced is never looked for — so the missing
 * content was invisible to the suite and to everybody who does not read
 * Hungarian.
 *
 * These three counts are the cheap language-neutral shape of a guide. They do
 * not judge a word of the prose; they fail when one language stops saying
 * something the others still say. Bold is the load-bearing one: in these
 * pages it marks the name of a control the reader has to press.
 */
describe("the translations keep the original's shape", () => {
  const shape = (text: string) => ({
    headings: [...text.matchAll(/^(#+) /gm)].map(([, h]) => h.length),
    steps: [...text.matchAll(/^\s*\d+\. /gm)].length,
    bullets: [...text.matchAll(/^\s*- /gm)].length,
    controls: [...text.matchAll(/\*\*/g)].length / 2,
  });

  test("every guide has the same headings, steps and named controls in every language", () => {
    for (const guide of GUIDES) {
      const english = shape(read("en", guide));
      for (const locale of LOCALES) {
        expect(shape(read(locale, guide)), `${locale}/${guide}`).toEqual(english);
      }
    }
  });
});

describe("the guides sit in the shared shell", () => {
  test("they render the shared nav rather than one of their own", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "app/docs/guide/[guide]/page.tsx"),
      "utf8",
    );
    expect(src).toContain("DocsNav");
    expect(src).not.toContain("GuideNav");
    // The shell's header is the way out; a second one under it was the
    // "Alle Dokumente" link that led to a page with no way home at all.
    expect(src).not.toContain("guides.backToDocs");
  });
});

