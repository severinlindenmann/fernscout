import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B2673 — a duplicate key in a locale file is invisible to `JSON.parse`
 * (the object literal keeps only the last value), so this scans the raw
 * text instead. `studio.share.failed` was defined twice in every maintained
 * locale: once for the story share screen, once — later in the file, so it
 * won — for `components/studio/ThisPhone.tsx`'s own failure text, which
 * silently told every failed story share to "reload the studio".
 */

const LOCALES_DIR = path.join(process.cwd(), "site", "locales");

/** Top-level `"key": ` lines only — a locale file is one flat object, one
 * key per line, which is exactly what makes a duplicate possible: two lines
 * with the same key are both syntactically valid JSON. */
function topLevelKeys(raw: string): string[] {
  const keys: string[] = [];
  const re = /^\s*"((?:[^"\\]|\\.)*)"\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    keys.push(match[1]);
  }
  return keys;
}

describe("B2673 — no locale file defines the same key twice", () => {
  for (const locale of MAINTAINED_LOCALES) {
    test(`site/locales/${locale}.json has no duplicate key`, () => {
      const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8");
      const keys = topLevelKeys(raw);
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const key of keys) {
        if (seen.has(key)) duplicates.add(key);
        seen.add(key);
      }
      expect([...duplicates]).toEqual([]);
    });
  }

  test("the scan itself catches a duplicate (sanity check)", () => {
    const withDuplicate = '{\n  "a.b": "one",\n  "c.d": "two",\n  "a.b": "three"\n}\n';
    const keys = topLevelKeys(withDuplicate);
    expect(keys).toEqual(["a.b", "c.d", "a.b"]);
  });

  test("studio.share.failed is the story text, not This phone's", () => {
    const raw = fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    expect(parsed["studio.share.failed"]).toBe("That did not work. Try again.");
    expect(parsed["studio.thisPhone.shareFailed"]).toContain("Reload the studio");
  });
});
