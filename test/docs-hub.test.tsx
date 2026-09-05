import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B470 — the hub is a hub.
 *
 * "There are two menus for Anleitungen" was the complaint, and the cause was
 * that `/docs` was an index *and* a document: a row of anchors to its own
 * sections beside a row of links to pages. A hub answers one question — where
 * are you going — so the test is that it has no sections of its own to
 * scroll to.
 */
const raw = fs.readFileSync(path.join(process.cwd(), "app/docs/page.tsx"), "utf8");

/**
 * The file with its prose removed.
 *
 * These assertions are about what the page *renders*, and this page's own
 * comments name the things it deliberately does not render — `DocsNav`, and
 * the old English headings — because the reasoning is the point of the file.
 * Matching raw text failed on the explanation rather than on the code, which
 * is a test that punishes documenting the decision.
 */
const src = raw
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

describe("the documentation hub", () => {
  test("it has no in-page anchors, so only one kind of link is on it", () => {
    expect(src).not.toContain('href="#');
    expect(src).not.toContain("scroll-mt");
  });

  test("it renders the six pages from the shared list", () => {
    expect(src).toContain("DOCS_PAGES");
  });

  test("it does not render the nav as well as the cards", () => {
    // The cards *are* the navigation here. A DocsNav above them would be the
    // second menu again, in a new place.
    expect(src).not.toContain("DocsNav");
  });

  test("it names both groups and says which one is English", () => {
    expect(src).toContain("docs.guidesGroup");
    expect(src).toContain("docs.technicalGroup");
    expect(src).toContain("docs.technicalGroupNote");
  });

  test("no English section heading is hardcoded on it any more", () => {
    for (const heading of ["How to Use", "How to Host", "How to Contribute", "Fernscout docs"]) {
      expect(src, heading).not.toContain(heading);
    }
  });

  test("every heading it shows comes from the dictionary, in every language", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    for (const locale of ["en", "de", "hu"]) {
      const dict = dictionaryFor(locale);
      for (const key of [
        "docs.title",
        "docs.lede",
        "docs.guidesGroup",
        "docs.guidesGroupNote",
        "docs.technicalGroup",
        "docs.technicalGroupNote",
      ]) {
        expect(dict[key], `${locale} ${key}`).toBeTruthy();
      }
      // The German hub must not carry the old English headings.
      expect(dict["docs.guidesGroup"]).not.toMatch(/^How to /);
    }
  });
});
