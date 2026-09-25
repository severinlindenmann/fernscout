import { describe, expect, test } from "vitest";
import { DOCS_PAGES, docsNavEntries } from "@/lib/docs";
import { dictionaryFor } from "@/lib/locales";

/**
 * B470 — the pages, listed once.
 *
 * The hub's cards, the inner pages' nav and the routes themselves all have to
 * agree about what exists. Before this they did not: the guides were a list in
 * one component and the technical sections were anchors written by hand in
 * another, which is why they were drawn as the same kind of pill while one
 * navigated and the other scrolled.
 */
describe("the documentation pages", () => {
  test("there are five: four technical pages and the one guide left", () => {
    // B1826 removed `/docs/extract`, B2248 `/docs/roadmap`, and the guest,
    // creator and buddy guides went once the screens they described carried
    // their own guidance — see `lib/docs.ts` above `DOCS_PAGES`. B2343's
    // `gps` guide is the one reader guide that stays.
    expect(DOCS_PAGES.map((p) => p.id)).toEqual(["hosting", "api", "contributing", "helper", "gps"]);
    for (const retired of ["guest", "creator", "buddy"]) {
      expect(DOCS_PAGES.some((p) => p.href === `/docs/guide/${retired}`), retired).toBe(false);
    }
  });

  test("every page has a real route, and a label and a blurb in every language", () => {
    for (const page of DOCS_PAGES) {
      expect(page.href).toMatch(/^\/docs\//);
      for (const locale of ["en", "de", "hu"]) {
        expect(dictionaryFor(locale)[page.labelKey], `${locale} ${page.labelKey}`).toBeTruthy();
        expect(dictionaryFor(locale)[page.blurbKey], `${locale} ${page.blurbKey}`).toBeTruthy();
      }
    }
  });

  test("the nav is the same list, in the same order", () => {
    expect(docsNavEntries().map((e) => e.href)).toEqual(DOCS_PAGES.map((p) => p.href));
  });
});
