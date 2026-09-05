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

describe("the figures", () => {
  const FIGURES = "docs/guides/figures";

  test("every image a guide references is actually on disk", () => {
    for (const locale of LOCALES) {
      for (const guide of GUIDES) {
        const text = fs.readFileSync(
          path.join(process.cwd(), `docs/guides/${locale}/${guide}.md`),
          "utf8",
        );
        for (const [, src] of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
          expect(src, `${locale}/${guide}`).toMatch(/^\/docs\/guides\/figures\//);
          const file = src.replace("/docs/guides/figures/", "");
          expect(
            fs.existsSync(path.join(process.cwd(), FIGURES, file)),
            `${locale}/${guide} references ${file}`,
          ).toBe(true);
        }
      }
    }
  });

  /** Every figure carries alt text. These pages are read by people who are
   * already unsure; an unlabelled picture is one more thing to puzzle over,
   * and for a screen-reader it is nothing at all. */
  test("no figure is unlabelled", () => {
    for (const locale of LOCALES) {
      for (const guide of GUIDES) {
        const text = fs.readFileSync(
          path.join(process.cwd(), `docs/guides/${locale}/${guide}.md`),
          "utf8",
        );
        for (const [, alt] of text.matchAll(/!\[([^\]]*)\]\([^)]+\)/g)) {
          expect(alt.length, `${locale}/${guide}`).toBeGreaterThan(20);
        }
      }
    }
  });

  /**
   * A screenshot committed at retina resolution bloats every clone of this
   * repository for ever — `docs/screenshots/README.md` sets that rule for the
   * four it owns, and these are held to the same one.
   */
  /**
   * B477 — the two pictures of iOS itself.
   *
   * Apple only allows notifications from an installed app, so the Home Screen
   * step is the one instruction without which the whole feature is unreachable
   * on an iPhone — and it was the only step with no picture, because it is
   * system UI that no browser automation here can reach. These came from a
   * real phone.
   *
   * They carry no language suffix on purpose: the words in them belong to the
   * phone, not to us, so every guide shows the same English capture and says
   * so in its own caption.
   */
  test("every guest guide shows the iOS Home Screen steps", () => {
    for (const locale of LOCALES) {
      const text = read(locale, "guest");
      expect(text, locale).toContain("ios-share.webp");
      expect(text, locale).toContain("ios-add-home.webp");
    }
  });

  test("the translated guides say the iOS pictures are in English", () => {
    // English needs no such note; the other two would otherwise show a reader
    // a menu whose words do not match their own phone, with no explanation.
    expect(read("de", "guest")).toMatch(/auf Englisch eingestellt/);
    expect(read("hu", "guest")).toMatch(/angol nyelvű iPhone/);
  });

  test("the figures stay inside their byte budget", () => {
    const dir = path.join(process.cwd(), FIGURES);
    const total = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".webp"))
      .reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
    expect(total).toBeLessThan(200 * 1024);
  });

  /** Hungarian has no captures of its own, so it borrows the English ones —
   * and must say so rather than showing a reader a language they did not ask
   * for with no explanation. */
  test("the Hungarian guide warns that its screenshots are in English", () => {
    const text = fs.readFileSync(path.join(process.cwd(), "docs/guides/hu/guest.md"), "utf8");
    expect(text).toMatch(/angol nyelv/i);
  });
});

describe("what the guides have to cover", () => {
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

  /**
   * The one thing "How to Use" said that lives nowhere else — B470. The rest
   * of that section (hand this to your agent) is on the landing page in the
   * dashed box and in this guide's own opening, which is why the section
   * could be retired rather than moved.
   */
  test("every creator guide explains that photographs need a timestamp", () => {
    for (const locale of LOCALES) {
      expect(read(locale, "creator"), locale).toMatch(/timestamp|Zeitstempel|időbélyeg/i);
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
