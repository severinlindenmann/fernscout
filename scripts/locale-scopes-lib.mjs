// Which UI strings each `LocaleProvider` has to ship — computed from the
// source, never listed by hand. Written to `lib/localeScopes.json` by
// `npm run i18n:keys`, read by `dictionaryFor(locale, scope)` in
// lib/locales.ts, and checked against a fresh computation by
// test/locale-scopes.test.ts, so a scope that no longer covers its pages fails
// the suite rather than rendering `studio.hub.title` to a reader.
//
// **Why.** Every page used to carry the whole English dictionary — 4,000-odd
// strings, ~330 KB — in its RSC payload, because the provider was handed
// `dictionaryFor(locale)` and a client component may ask it for any key. On a
// German page it went twice (the root layout's and the journal's, each a fresh
// merge), so `/docs` in German was 750 KB of HTML to show a list of links.
// A reader's page uses a few hundred of those strings.
//
// **The rule, and why it is conservative.** A scope is a set of files, and its
// keys are every key *mentioned* by anything those files import, transitively
// — server modules included, not only `"use client"` ones: a server page may
// hand a client component a key as a prop (`labelKey`, `fallbackNotice`), and
// the literal lives on the server side of that boundary. Mentioned means:
//
//   - a string literal that is a key, plus every key under it (`<key>.one`,
//     the singular `tn()` looks up beside a plural);
//   - a template literal's static head (`\`cost.cat.${c}\``), or a string
//     ending in "." (`"agent.error." + code`) — every key under that prefix.
//
// Nothing else can reach `t()`: its argument is a `TranslationKey`, so a key
// is either one of these literals or a cast, and the test holds every
// `as TranslationKey` cast in the codebase to the same two shapes. Comments
// are deliberately *not* stripped — a key named in a comment ships a string
// nobody reads, which costs bytes; stripping one out of a string that merely
// looked like a comment would cost a sentence.
//
// **`@paid/*`.** What resolves here is `lib/paid-stubs/`, which renders
// nothing. The real `paid/` is not in this repository, so the keys its pages
// use cannot be known from here: each scope records which paid areas its
// files reach through a stub that renders or translates (`paidAreaOf`), and
// `dictionaryFor` ships that scope whole when the running build carries one
// of them (`PAID_AREAS`). The open edition gets the small payload everywhere;
// a hosted build gets it for the scopes that reach no paid UI, and the whole
// dictionary — once per page, no longer twice — for the rest.
import fs from "node:fs";
import path from "node:path";

/**
 * Every place a dictionary is handed to the client, and what it covers.
 *
 * `layout` — the provider in this layout wraps its `children`, so the scope is
 * every route file in the layout's directory and below (pages, layouts,
 * error/not-found/loading…), stopping at a deeper `layout` scope, whose own
 * layout file still counts here too: anything it renders outside its own
 * provider (`IdentityUpgrade` in the journal layout) reads this one.
 *
 * `files` — a dictionary handed to one component tree rather than to a route:
 * a provider around part of a page, or a component that takes a `dictionary`
 * prop and translates with it directly. `at` names the files that call
 * `dictionaryFor(…, scope)` for it, when those are not the `files` themselves.
 *
 * The test holds this table and the code to each other both ways: every
 * `dictionaryFor`/`dictionariesFor` in `app/` and `components/` names a scope,
 * and a scope is asked for in exactly the files listed here — so moving a
 * provider to a page this table does not describe fails, rather than shipping
 * the strings of wherever it used to be.
 *
 * A nested provider replaces the one above it rather than extending it, so
 * every scope is complete on its own. That costs a little overlap on a nested
 * page (the root's few dozen strings ride along under the journal's) and buys
 * a rule with no ordering in it: which strings a page has never depends on
 * which layout the client router happened to keep from the previous page.
 */
export const SCOPES = {
  // The landing page, notices, 404s, `/legal` — and the chrome of every
  // nested layout that renders anything outside its provider.
  root: { layout: "app/layout.tsx" },
  // The operator console and the sign-up page carry the helper's whole
  // vocabulary; nowhere else under the root needs it.
  admin: { layout: "app/admin/layout.tsx" },
  welcome: { layout: "app/welcome/layout.tsx" },
  // A reader's journal: the story, trips, the gallery, the map.
  journal: { layout: "app/[user]/layout.tsx" },
  // The reader's own page and the owner's studio — the two places inside a
  // journal that carry forms, flows and the helper's words.
  me: { layout: "app/[user]/me/layout.tsx" },
  studio: { layout: "app/[user]/studio/layout.tsx" },
  // The documentation. `/docs/api` reaches the helper's tool definitions on
  // the server, and with them the helper's vocabulary.
  docs: { layout: "app/docs/layout.tsx" },
  // `/legal` renders under its own provider in the reader's language.
  legal: { files: ["app/legal/page.tsx"] },
  // `/<user>/c/<token>` in the contact's own language rather than the reader's.
  contactPage: { files: ["app/[user]/c/[token]/page.tsx"] },
  // Components that translate from a `dictionary`/`dictionaries` prop.
  contactManage: { files: ["components/ContactManage.tsx"], at: ["app/[user]/me/page.tsx"] },
  readersAdmin: { files: ["components/studio/readers/ReadersAdmin.tsx"], at: ["app/[user]/studio/readers/page.tsx"] },
  ownDetails: { files: ["components/studio/readers/OwnDetails.tsx"], at: ["app/[user]/studio/journal/page.tsx"] },
};

/** The files Next renders for a route segment — never a `route.ts`, which
 * renders no React. */
const ROUTE_FILE = /^(page|layout|template|error|not-found|loading|default|forbidden|unauthorized|global-error)\.(tsx|ts|jsx|js)$/;
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", "/index.ts", "/index.tsx"];

/** Every key under `prefix` (and `prefix` itself). `allKeys` is sorted, so
 * they sit in one run starting where `prefix` would. */
function keysUnder(prefix, allKeys, { exact }) {
  let low = 0;
  let high = allKeys.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (allKeys[mid] < prefix) low = mid + 1;
    else high = mid;
  }
  const under = exact ? `${prefix}.` : prefix;
  const out = [];
  for (let i = low; i < allKeys.length && allKeys[i].startsWith(prefix); i++) {
    if (allKeys[i] === prefix || allKeys[i].startsWith(under)) out.push(allKeys[i]);
  }
  return out;
}

/**
 * The keys a source file mentions — see the rule at the top. `namespaces` is
 * the set of first segments ("studio", "nav", …) so a string like
 * "config.json" or "next.config" is not mistaken for a key.
 *
 * The one block skipped is `TranslationKey` itself in lib/i18n.ts: it names
 * every key there is, and is a type, which ships nothing.
 */
export function keysMentioned(source, allKeys, namespaces) {
  const code = source.replace(/export type TranslationKey =[\s\S]*?;\n/, "");
  const found = new Set();
  for (const match of code.matchAll(/(["'`])([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9_.-]*)(\1|\$\{)/g)) {
    const [, , literal, end] = match;
    if (!namespaces.has(literal.slice(0, literal.indexOf(".")))) continue;
    const isPrefix = end === "${" || literal.endsWith(".");
    for (const key of keysUnder(literal, allKeys, { exact: !isPrefix })) found.add(key);
  }
  return found;
}

/** The module specifiers a file imports at runtime. `import type` ships
 * nothing and is skipped; a mixed `import { type A, b }` is kept whole. */
export function importsOf(source) {
  const specifiers = [];
  const pattern =
    /\b(import|export)\s+(type\s+)?[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[2]) continue;
    specifiers.push(match[3] ?? match[4] ?? match[5]);
  }
  return specifiers;
}

function resolveModule(root, from, specifier) {
  let base;
  // `@paid/*` is resolved to the stub on purpose, even beside a real `paid/`:
  // the output is committed, and must come out the same from every checkout.
  if (specifier.startsWith("@/")) base = path.join(root, specifier.slice(2));
  else if (specifier.startsWith("@paid/")) base = path.join(root, "lib", "paid-stubs", specifier.slice("@paid/".length));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = base + extension;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.(tsx?|mts|jsx?)$/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * The paid area a stub stands in for, when the real module could ask for a
 * string: it renders (`.tsx`), or its signature — which a stub keeps — takes
 * or returns a key or a translator. A stub for `whatsappSignInOffered()` or a
 * price table's constants cannot put a key in front of `t()`, and marking a
 * scope by it would ship the whole dictionary on a hosted build for nothing.
 */
function paidAreaOf(root, file, source) {
  const stubs = path.join(root, "lib", "paid-stubs") + path.sep;
  if (!file.startsWith(stubs)) return null;
  const [area] = file.slice(stubs.length).split(path.sep);
  if (area === "manifest.ts") return null;
  return /\.(tsx|jsx)$/.test(file) || /TranslationKey|translate|useI18n/.test(source) ? area : null;
}

function routeFilesUnder(dir, stopAt) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (stopAt.has(full)) {
          // A deeper scope's own layout still renders under this one.
          const layout = fs.readdirSync(full).find((name) => /^layout\.(tsx|ts|jsx|js)$/.test(name));
          if (layout) out.push(path.join(full, layout));
          continue;
        }
        walk(full);
      } else if (ROUTE_FILE.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * `{ [scope]: { keys, paid } }` for the repository at `root`, keys in
 * dictionary order so the committed file diffs line by line.
 */
export function computeLocaleScopes(root, scopes = SCOPES) {
  // Every shipped locale's keys, not English's alone: `fallback.writtenIn.en`
  // is what German says about a day written in English, and English has no
  // such sentence about itself — so it exists only in the other files, and a
  // scope built from en.json's keys shipped a German reader the key instead.
  const localesDir = path.join(root, "site", "locales");
  const every = new Set();
  for (const name of fs.readdirSync(localesDir).filter((file) => file.endsWith(".json")).sort()) {
    for (const key of Object.keys(JSON.parse(fs.readFileSync(path.join(localesDir, name), "utf8")))) every.add(key);
  }
  const allKeys = [...every].sort();
  const namespaces = new Set(allKeys.map((key) => key.slice(0, key.indexOf("."))));

  const cache = new Map();
  const moduleInfo = (file) => {
    let info = cache.get(file);
    if (info) return info;
    const source = fs.readFileSync(file, "utf8");
    const imports = [];
    for (const specifier of importsOf(source)) {
      const resolved = resolveModule(root, file, specifier);
      if (resolved) imports.push(resolved);
    }
    info = { imports, paid: paidAreaOf(root, file, source), keys: keysMentioned(source, allKeys, namespaces) };
    cache.set(file, info);
    return info;
  };

  const layoutDirs = new Set(
    Object.values(scopes)
      .filter((scope) => scope.layout)
      .map((scope) => path.dirname(path.join(root, scope.layout))),
  );

  const result = {};
  for (const [name, scope] of Object.entries(scopes)) {
    let entryFiles;
    if (scope.layout) {
      const dir = path.dirname(path.join(root, scope.layout));
      const deeper = new Set([...layoutDirs].filter((other) => other !== dir && other.startsWith(dir + path.sep)));
      entryFiles = routeFilesUnder(dir, deeper);
    } else {
      entryFiles = scope.files.map((file) => path.join(root, file));
    }
    for (const file of entryFiles) {
      if (!fs.existsSync(file)) throw new Error(`Locale scope "${name}" names ${path.relative(root, file)}, which does not exist.`);
    }

    const seen = new Set();
    const stack = [...entryFiles];
    const keys = new Set();
    const paid = new Set();
    while (stack.length > 0) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const info = moduleInfo(file);
      for (const key of info.keys) keys.add(key);
      if (info.paid) paid.add(info.paid);
      stack.push(...info.imports);
    }
    result[name] = {
      paid: [...paid].sort(),
      keys: allKeys.filter((key) => keys.has(key)),
    };
  }
  return result;
}

/** The committed form: one key per line, so a change reads as a diff of the
 * strings a page gained or lost. */
export function formatLocaleScopes(scopes) {
  return `${JSON.stringify(scopes, null, 2)}\n`;
}
