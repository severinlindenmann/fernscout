import { describe, expect, test } from "vitest";
import { DOCS_PAGES, docsNavEntries } from "@/lib/docs";
import { dictionaryFor } from "@/lib/locales";

/**
 * B470 — the six pages, listed once.
 *
 * The hub's cards, the inner pages' nav and the routes themselves all have to
 * agree about what exists. Before this they did not: the guides were a list in
 * one component and the technical sections were anchors written by hand in
 * another, which is why they were drawn as the same kind of pill while one
 * navigated and the other scrolled.
 */
describe("the documentation pages", () => {
  test("there are six, in two groups", () => {
    expect(DOCS_PAGES).toHaveLength(6);
    expect(DOCS_PAGES.filter((p) => p.group === "guides")).toHaveLength(3);
    expect(DOCS_PAGES.filter((p) => p.group === "technical")).toHaveLength(3);
  });

  test("every page has a real route and a label in every language", () => {
    for (const page of DOCS_PAGES) {
      expect(page.href).toMatch(/^\/docs\//);
      for (const locale of ["en", "de", "hu"]) {
        expect(dictionaryFor(locale)[page.labelKey], `${locale} ${page.labelKey}`).toBeTruthy();
      }
    }
  });

  test("the nav marks where the second group begins, exactly once", () => {
    const entries = docsNavEntries();
    expect(entries).toHaveLength(6);
    expect(entries.filter((e) => e.startsGroup)).toHaveLength(1);
    // And it is the first technical page, not an arbitrary one.
    expect(entries.findIndex((e) => e.startsGroup)).toBe(3);
  });
});
