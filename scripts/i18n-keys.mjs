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
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { computeLocaleScopes, formatLocaleScopes } from "./locale-scopes-lib.mjs";
import { decidePaidLocaleKeysAction } from "./paid-locale-keys-lib.mjs";

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
} else {
  fs.writeFileSync(file, source.slice(0, start) + union + source.slice(end));
  console.log(`Wrote ${keys.length} keys into lib/i18n.ts`);
}

// --- Scopes ---
//
// Which of those keys each `LocaleProvider` ships — scripts/locale-scopes-lib.mjs
// says how they are worked out. Regenerated here because a new key, or an old
// one used somewhere new, changes them; test/locale-scopes.test.ts fails until
// this file matches the source again.
const scopesFile = path.join(ROOT, "lib", "localeScopes.json");
const scopes = formatLocaleScopes(computeLocaleScopes(ROOT));
const previousScopes = fs.existsSync(scopesFile) ? fs.readFileSync(scopesFile, "utf8") : null;
if (previousScopes === scopes) {
  console.log("Locale scopes already up to date.");
} else {
  fs.writeFileSync(scopesFile, scopes);
  const summary = Object.entries(JSON.parse(scopes))
    .map(([name, scope]) => `${name} ${scope.keys.length}`)
    .join(", ");
  console.log(`Wrote lib/localeScopes.json — ${summary}`);
}

// --- Keys `paid/` alone uses — B2112 ---
//
// `test/studio-text-sweep.test.tsx`'s orphan sweep reads every literal,
// template head and "prefix." in app/, components/, lib/ and scripts/, plus
// paid/ when a checkout has it. A checkout without it (every worktree but
// the main one) cannot see what paid/ uses, so a key genuinely read only by
// a paid area would look orphaned and get deleted out from under it. This
// file is the fix: computed here, in the one checkout that does have paid/,
// and committed so every other checkout can still tell "orphaned" from
// "paid uses this" without paid/ physically present. Regenerated whenever
// paid/ exists; left alone otherwise, so a worktree lacking paid/ never
// overwrites it with a smaller, wrong answer.
function collectFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : collectFiles(full);
    return /\.(tsx?|mjs|js)$/.test(entry.name) ? [full] : [];
  });
}
function usedKeys(files, allKeys) {
  const literals = new Set();
  const templates = [];
  const prefixes = [];
  const escape = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const file of files) {
    // Only the `TranslationKey` union itself ships nothing — lib/i18n.ts
    // also holds real helpers (`telHintKey`, `plural`) that map to real
    // keys, so the whole file cannot be skipped, only that union.
    const raw = fs.readFileSync(file, "utf8");
    const source = file === path.join(ROOT, "lib", "i18n.ts") ? raw.replace(/export type TranslationKey =[\s\S]*?;\n/, "") : raw;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        literals.add(node.text);
        if (/^[\w-]+(\.[\w-]+)*\.$/.test(node.text)) prefixes.push(node.text);
      }
      if (ts.isTemplateExpression(node) && /^[\w-]+\./.test(node.head.text)) {
        templates.push(new RegExp(`^${escape(node.head.text)}${node.templateSpans.map((sp) => `[\\w.-]*${escape(sp.literal.text)}`).join("")}$`));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const used = new Set();
  for (const key of allKeys) {
    const base = key.replace(/\.one$/, "");
    if (literals.has(key) || literals.has(base) || templates.some((r) => r.test(key) || r.test(base)) || prefixes.some((p) => key.startsWith(p) || base.startsWith(p))) {
      used.add(key);
    }
  }
  return used;
}
const paidLocaleKeysFile = path.join(ROOT, "lib", "paidLocaleKeys.json");
const paidDir = path.join(ROOT, "paid");
const force = process.argv.includes("--force");
const paidExists = fs.existsSync(paidDir);
const previous = fs.existsSync(paidLocaleKeysFile) ? JSON.parse(fs.readFileSync(paidLocaleKeysFile, "utf8")) : null;
const previousGeneratedFrom = previous?.generatedFrom ?? null;

const git = (args) => execFileSync("git", ["-C", paidDir, ...args], { encoding: "utf8" }).trim();

const decision = paidExists
  ? decidePaidLocaleKeysAction({
      paidExists: true,
      paidDirty: git(["status", "--porcelain"]).length > 0,
      previousGeneratedFrom,
      currentCommit: git(["rev-parse", "HEAD"]),
      isAncestor: (ancestor, descendant) => {
        try {
          execFileSync("git", ["-C", paidDir, "merge-base", "--is-ancestor", ancestor, descendant]);
          return true;
        } catch {
          return false;
        }
      },
      force,
    })
  : decidePaidLocaleKeysAction({ paidExists: false });

if (decision.action === "skip" || decision.action === "refuse") {
  console.log(decision.message);
} else {
  const currentCommit = git(["rev-parse", "HEAD"]);
  const openCoreFiles = ["app", "components", "lib", "scripts"].flatMap((d) => collectFiles(path.join(ROOT, d)));
  const withPaidFiles = [...openCoreFiles, ...collectFiles(paidDir)];
  // A key deleted from English that paid/ still reads stays declared, so
  // test/paid-locale-keys.test.ts fails in public CI instead of the file
  // quietly forgetting it (B2554).
  const candidates = [...new Set([...keys, ...(previous?.keys ?? [])])].sort();
  const usedOpenCore = usedKeys(openCoreFiles, candidates);
  const usedWithPaid = usedKeys(withPaidFiles, candidates);
  const paidOnly = candidates.filter((k) => !usedOpenCore.has(k) && usedWithPaid.has(k));
  const paidLocaleKeys = JSON.stringify({ generatedFrom: currentCommit, keys: paidOnly }, null, 2) + "\n";
  const previousRaw = fs.existsSync(paidLocaleKeysFile) ? fs.readFileSync(paidLocaleKeysFile, "utf8") : null;
  if (previousRaw === paidLocaleKeys) {
    console.log("Paid-only locale keys already up to date.");
  } else {
    fs.writeFileSync(paidLocaleKeysFile, paidLocaleKeys);
    console.log(`Wrote lib/paidLocaleKeys.json — ${paidOnly.length} keys only paid/ uses (from ${currentCommit}).`);
  }
}

// --- Coverage — B1894 ---
//
// This regenerates the union from English and stops. It never looked at any
// other locale, so a key added to English (and even to German) and never to
// Hungarian passed clean: the studio run of 2026-09-19 added 336 studio.*
// keys across five tickets, Hungarian got none of them, and nothing
// mechanical noticed — a security review reading a ticket's own acceptance
// line is what caught it.
//
// **Reports. Never fails.** A locale behind English is this repository's
// normal state, not a defect — AGENTS.md is explicit that a missing
// translation must be declared, never invented, and an agent (or a person)
// who cannot write a language is supposed to leave the task short of done
// rather than fabricate one. A red exit code here would push exactly that
// person toward inventing a string they cannot check, which is the one
// outcome this rule exists to prevent. So this walks every `site/locales/*`
// file that ships beside `en.json` — not only `MAINTAINED_LOCALES`, since a
// locale can be added to the repository before it earns a place in that
// list — and prints what each one lacks. Nothing here changes `process.exit`.
const localesDir = path.join(ROOT, "site", "locales");
const shipped = fs
  .readdirSync(localesDir)
  .filter((name) => name.endsWith(".json") && name !== "en.json")
  .map((name) => name.slice(0, -".json".length))
  .sort();

console.log(`\nCoverage against en.json's ${keys.length} keys:`);
for (const code of shipped) {
  const locale = JSON.parse(
    fs.readFileSync(path.join(localesDir, `${code}.json`), "utf8"),
  );
  // `fallback.writtenIn.<code>` is deliberately absent from a locale's own
  // file — it is the sentence *other* languages show about this one, never
  // what a locale says about itself (see `fallback.writtenIn.de`, present
  // only in en.json). Not a gap; excluded the same way the maintained-locale
  // test excludes it.
  const missing = keys.filter(
    (k) => k !== `fallback.writtenIn.${code}` && !(k in locale),
  );
  if (missing.length === 0) {
    console.log(`  ${code}: complete`);
    continue;
  }
  // Grouped by the prefix before the first "." — "studio.hub.title" and
  // "studio.hub.addDay.title" both count against "studio" — so a reader
  // sees which areas of the UI a locale has not caught up with rather than
  // a wall of dotted keys nobody can act on at a glance.
  const byPrefix = new Map();
  for (const key of missing) {
    const prefix = key.includes(".") ? key.slice(0, key.indexOf(".")) : key;
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  const breakdown = [...byPrefix.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([prefix, count]) => `${prefix} (${count})`)
    .join(", ");
  console.log(`  ${code}: missing ${missing.length} of ${keys.length} — ${breakdown}`);
}
