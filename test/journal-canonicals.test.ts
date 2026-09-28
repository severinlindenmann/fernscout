import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B2474 — four journal pages declared a canonical that was a 404 ("/trips",
 * "/search") or a literal route template ("/[user]/gallery"). A search
 * engine that trusts a canonical drops the page it is on. Every canonical a
 * journal page declares has to be built from that journal's own base.
 */
function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return pages(p);
    return /^(page|layout)\.tsx$/.test(d.name) ? [p] : [];
  });
}

const root = path.join(process.cwd(), "app/at/[user]");

/** A journal's own base: `journalPath(user)` (lib/journalPath.ts), which is
 * `/@<user>`, either as the whole value or opening a template literal. */
const JOURNAL_BASE = /^(`\$\{journalPath\((user|username)\)\}|journalPath\((user|username)\)$)/;

/** Each canonical value in a file, with a bare identifier resolved to its `const`. */
function canonicals(src: string): string[] {
  return [...src.matchAll(/canonical:\s*(`[^`]*`|"[^"]*"|'[^']*'|[A-Za-z_]\w*(?:\([^)]*\))?)/g)].map((m) => {
    const raw = m[1].trim();
    if (!/^[A-Za-z_]\w*$/.test(raw)) return raw;
    const def = src.match(new RegExp(`const ${raw}\\s*=\\s*([^;]+);`));
    return def ? def[1].trim() : raw;
  });
}

describe("journal canonicals point at their own journal", () => {
  const files = pages(root).filter((f) => fs.readFileSync(f, "utf8").includes("canonical:"));

  test("the scan finds the pages it is meant to guard", () => {
    // Deleting the scan's reach by accident would make every check below pass.
    expect(files.length).toBeGreaterThan(10);
  });

  test.each(files.map((f) => [path.relative(process.cwd(), f)]))("%s", (file) => {
    const src = fs.readFileSync(file, "utf8");
    for (const value of canonicals(src)) {
      expect(value, "a route template is not a URL").not.toContain("[");
      expect(value, "a canonical outside the journal").toMatch(JOURNAL_BASE);
    }
  });

  test("the check catches the shapes B2474 found", () => {
    // The pre-`@` shape, `/${user}/…`, is now the app's root, not the journal.
    for (const bad of ['canonical: "/trips",', 'canonical: "/[user]/gallery",', "canonical: `/${user}/gallery`,"]) {
      const [value] = canonicals(bad);
      expect(value.includes("[") || !JOURNAL_BASE.test(value)).toBe(true);
    }
  });
});
