// Regenerates the TranslationKey union in lib/i18n.ts from the shipped English
// dictionary, which is the source of truth for what keys exist.
//
//   npm run i18n:keys
//
// The union exists so every t("…") call site is checked at compile time even
// though the strings themselves are data. Without it, a typo in a key would
// render the key text on the page and nothing would fail.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

// `site/locales/`, and deliberately not the resolution `lib/locales.ts` uses.
//
// At runtime a dictionary is the shipped file merged with an instance's own
// `$CONTENT_DIR/locales/`, so an operator can reword the UI. That is the right
// rule for reading and the wrong one here: this generates a *compile-time*
// union for `t()` call sites in the shipped code, so it must depend only on
// what ships. Resolving `CONTENT_DIR` would make the generated type differ
// between two checkouts of the same commit, and an instance cannot add a key
// the code could reference anyway.
//
// It read `content/locales/` until B529 — where these lived before B510 moved
// the instance's own files into `site/`. The script was not moved with them and
// crashed with ENOENT, so three sessions in a row hand-edited the union
// instead, which is exactly the drift it exists to prevent.
const en = JSON.parse(
  fs.readFileSync(path.join(ROOT, "site", "locales", "en.json"), "utf8"),
);
const keys = Object.keys(en).sort();

const file = path.join(ROOT, "lib", "i18n.ts");
const source = fs.readFileSync(file, "utf8");

const start = source.indexOf("export type TranslationKey =");
const end = source.indexOf(";", start) + 1;
if (start < 0) {
  console.error("Could not find the TranslationKey union in lib/i18n.ts");
  process.exit(1);
}

const union = `export type TranslationKey =\n  | ${keys.map((k) => `"${k}"`).join("\n  | ")};`;
if (source.slice(start, end) === union) {
  console.log(`Already up to date — ${keys.length} keys.`);
  process.exit(0);
}

fs.writeFileSync(file, source.slice(0, start) + union + source.slice(end));
console.log(`Wrote ${keys.length} keys into lib/i18n.ts`);
