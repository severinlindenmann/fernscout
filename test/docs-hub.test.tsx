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

  test("it renders its pages from the shared list", () => {
    expect(src).toContain("DOCS_PAGES");
  });

  test("it does not render the nav as well as the cards", () => {
    // The cards *are* the navigation here. A DocsNav above them would be the
    // second menu again, in a new place.
    expect(src).not.toContain("DocsNav");
  });

  test("it links no retired reader guide and no workbench", () => {
    expect(src).not.toContain("/docs/guide/");
    // The benches moved to Contributing: the hub's reader has no use for one.
    expect(src).not.toContain("/docs/branding");
  });

  test("the door to a journal, and the ways to write one, are there only when writing is", () => {
    // Closed by default: without `auth` nobody can write, so neither may be
    // drawn — and WhatsApp only where the instance actually reads it.
    expect(src).toMatch(/const writing = isEnabled\("auth"\)/);
    expect(src).toMatch(/\{writing && \(\s*<DoorCard/);
    expect(src).toMatch(/\{writing && \(\s*<section/);
    expect(src).toMatch(/isEnabled\("whatsappInbound"\) && \(\s*<Way/);
  });

  test("no English section heading is hardcoded on it any more", () => {
    for (const heading of ["How to Use", "How to Host", "How to Contribute", "Fernscout docs"]) {
      expect(src, heading).not.toContain(heading);
    }
  });

  test("every string it shows comes from the dictionary, in every language", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    const keys = [...raw.matchAll(/"(docs\.[a-zA-Z.]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    for (const locale of ["en", "de", "hu"]) {
      const dict = dictionaryFor(locale);
      for (const key of keys) {
        expect(dict[key], `${locale} ${key}`).toBeTruthy();
      }
    }
    // The technical doors say, in the reader's own language, that what is
    // behind them is English.
    expect(dictionaryFor("de")["docs.hosting.eyebrow"]).toContain("Englisch");
    expect(dictionaryFor("hu")["docs.api.eyebrow"]).toContain("angolul");
  });
});
