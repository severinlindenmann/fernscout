import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasLegal, legalLocales, readLegal } from "@/lib/legal";

/**
 * The imprint page is content, not code (lib/legal.ts says why), so the two
 * things worth testing are the two things that decide whether a reader sees a
 * page at all: an instance that wrote none must draw no link, and a reader
 * asking for a language nobody wrote must get *something* rather than a 404.
 */

let dir: string;
const original = process.env.CONTENT_DIR;
const originalSite = process.env.SITE_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-legal-"));
  process.env.CONTENT_DIR = dir;
  // Since B510 the imprint ships in `site/`, and this repository has one — so
  // an empty CONTENT_DIR no longer means "no imprint anywhere". Point both at
  // the fixture, and each test says which of the two it is writing into.
  process.env.SITE_DIR = dir;
});

afterEach(() => {
  if (original === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = original;
  if (originalSite === undefined) delete process.env.SITE_DIR;
  else process.env.SITE_DIR = originalSite;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(locale: string, body: string) {
  fs.mkdirSync(path.join(dir, "legal"), { recursive: true });
  fs.writeFileSync(path.join(dir, "legal", `${locale}.md`), body);
}

describe("the instance's legal page", () => {
  test("an instance that wrote none has none, and says so rather than throwing", () => {
    expect(hasLegal()).toBe(false);
    expect(legalLocales()).toEqual([]);
    expect(readLegal("de")).toBeNull();
  });

  test("serves the asked-for language when it exists", () => {
    write("en", "english");
    write("de", "deutsch");
    expect(readLegal("de")).toEqual({ markdown: "deutsch", locale: "de" });
    expect(hasLegal()).toBe(true);
  });

  test("falls back rather than 404s, and reports the language it fell back to", () => {
    write("en", "english");
    expect(readLegal("hu")).toEqual({ markdown: "english", locale: "en" });
  });

  test("a German-only instance serves German to an English reader", () => {
    write("de", "deutsch");
    expect(readLegal("en")).toEqual({ markdown: "deutsch", locale: "de" });
  });

  test("a locale that is not two letters cannot reach out of the folder", () => {
    write("en", "english");
    fs.writeFileSync(path.join(dir, "secret.md"), "not yours");
    expect(readLegal("../secret")).toEqual({ markdown: "english", locale: "en" });
  });

  /**
   * B510. The imprint used to live under `CONTENT_DIR`, which meant it only
   * reached production if somebody remembered to copy it — B56's shape, on the
   * one page whose absence is a legal problem. It ships in the checkout now,
   * and an instance that keeps its own beside its journals still wins.
   */
  test("the checkout's imprint serves when the content folder has none", () => {
    const site = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-legal-site-"));
    process.env.SITE_DIR = site;
    try {
      fs.mkdirSync(path.join(site, "legal"));
      fs.writeFileSync(path.join(site, "legal", "en.md"), "shipped");
      expect(readLegal("en")).toEqual({ markdown: "shipped", locale: "en" });

      // And an instance's own copy overrides it, wholesale.
      write("en", "ours");
      expect(readLegal("en")).toEqual({ markdown: "ours", locale: "en" });
    } finally {
      fs.rmSync(site, { recursive: true, force: true });
    }
  });
});
