import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GUIDES, isGuide, readGuide } from "@/lib/docs";

/**
 * B445 — the three reader guides.
 *
 * The content is prose and nothing here judges it. What is worth pinning is
 * the shape around it: that every guide exists in every language the site
 * offers, that a missing one degrades to English rather than to a crash, and
 * that the pages saying "not translated" cannot start lying because somebody
 * added a file without a string.
 */

const LOCALES = ["en", "de", "hu"];

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
    const { markdown, locale } = readGuide("guest", "fr");
    expect(locale).toBe("en");
    expect(markdown.length).toBeGreaterThan(1500);
  });

  test("a guide with no copy at all throws rather than rendering empty", () => {
    // @ts-expect-error — deliberately outside the union, which is the case a
    // bad route param would produce if `isGuide` were ever dropped.
    expect(() => readGuide("nonesuch", "en")).toThrow();
  });
});

describe("the route only accepts the three", () => {
  test("isGuide is the whitelist", () => {
    for (const guide of GUIDES) expect(isGuide(guide)).toBe(true);
    expect(isGuide("api")).toBe(false);
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
      expect(readGuide("guest", bad).locale, bad).toBe("en");
    }
  });
});

describe("what the guides have to cover", () => {
  const read = (locale: string, guide: string) =>
    fs.readFileSync(path.join(process.cwd(), `docs/guides/${locale}/${guide}.md`), "utf8");

  /**
   * The iOS Home Screen step is the one instruction without which the whole
   * notification feature is unreachable on an iPhone — Apple allows push only
   * from an installed app. A guest guide that omits it is a guest guide that
   * does not work.
   */
  test("every guest guide explains the iOS Home Screen step", () => {
    for (const locale of LOCALES) {
      const text = read(locale, "guest");
      expect(text, locale).toMatch(/Safari/);
      expect(text, locale).toMatch(/Home Screen|Home-Bildschirm|Főképernyőhöz|kezdőképernyő/i);
    }
  });

  test("every guest guide explains how to correct an address", () => {
    for (const locale of LOCALES) {
      expect(read(locale, "guest"), locale).toMatch(
        /your details|deinen Angaben|deine Angaben|adataidhoz|adataid/i,
      );
    }
  });

  /** The one thing a buddy is most likely to get wrong, in every language. */
  test("every buddy guide says a buddy cannot publish", () => {
    for (const locale of LOCALES) {
      expect(read(locale, "buddy"), locale).toMatch(
        /cannot publish|nicht veröffentlichen|nem tudsz közzétenni/i,
      );
    }
  });

  /** The creator guide's whole premise, and the project's decision 24. */
  test("every creator guide says there is no editing screen", () => {
    for (const locale of LOCALES) {
      expect(read(locale, "creator"), locale).toMatch(
        /no editing screen|keine Bearbeitungsoberfläche|nincs szerkesztőfelület/i,
      );
    }
  });
});
