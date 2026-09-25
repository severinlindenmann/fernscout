import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCOPES,
  computeLocaleScopes,
  formatLocaleScopes,
  importsOf,
  keysMentioned,
} from "../scripts/locale-scopes-lib.mjs";

/**
 * Locale scopes — each `LocaleProvider` ships the strings its files can ask
 * for, not all ~4,000 (scripts/locale-scopes-lib.mjs has the rule).
 *
 * A scope that is missing a key does not fail anywhere else: the page renders
 * `studio.hub.title` where a sentence should be, and only in the browser. So
 * this is where it has to fail — the committed scopes against a fresh scan of
 * the source, every call site against the table that says what it covers, and
 * every cast to `TranslationKey` against the shapes the scan can read.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(tsx?|mts)$/.test(entry.name)) continue;
    const full = path.join(entry.parentPath, entry.name);
    out.push(path.relative(ROOT, full));
  }
  return out;
}

const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** The text between a call's parentheses, starting just past `(`. */
function callArguments(source: string, open: number): string {
  let depth = 1;
  let i = open;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    i++;
  }
  return source.slice(open, i - 1);
}

describe("lib/localeScopes.json", () => {
  it("matches what the source mentions — run `npm run i18n:keys` if not", () => {
    const fresh = formatLocaleScopes(computeLocaleScopes(ROOT));
    const committed = read("lib/localeScopes.json");
    if (committed !== fresh) {
      // Name the difference rather than print two 5,000-line files.
      const was = JSON.parse(committed) as Record<string, { keys: string[]; paid: string[] }>;
      const now = JSON.parse(fresh) as Record<string, { keys: string[]; paid: string[] }>;
      const drift = Object.keys({ ...was, ...now }).flatMap((scope) => {
        const before = new Set(was[scope]?.keys ?? []);
        const after = new Set(now[scope]?.keys ?? []);
        const missing = [...after].filter((k) => !before.has(k));
        const extra = [...before].filter((k) => !after.has(k));
        const paid = (was[scope]?.paid ?? []).join() !== (now[scope]?.paid ?? []).join();
        return missing.length || extra.length || paid
          ? [`${scope}: needs ${missing.slice(0, 8).join(", ") || "—"}; no longer needs ${extra.slice(0, 8).join(", ") || "—"}${paid ? "; paid areas changed" : ""}`]
          : [];
      });
      expect.fail(`lib/localeScopes.json is stale — run \`npm run i18n:keys\`.\n  ${drift.join("\n  ")}`);
    }
  });
});

describe("where dictionaries are handed out", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components")];

  /** scope → the files that ask for it. */
  function sites(): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    const add = (scope: string, file: string) => {
      if (!found.has(scope)) found.set(scope, new Set());
      found.get(scope)!.add(file);
    };
    for (const file of files) {
      const source = read(file);
      for (const match of source.matchAll(/\bdictionar(?:y|ies)For\(/g)) {
        const args = callArguments(source, match.index + match[0].length);
        const scope = /,\s*"([A-Za-z]+)"\s*$/.exec(args)?.[1];
        // The one call whose scope is a variable: the provider the studio
        // and `/me` layouts render, whose `scope=` prop is its site instead.
        if (!scope && file === "components/JournalLocaleProvider.tsx" && /,\s*scope\s*$/.test(args)) continue;
        expect(
          scope,
          `${file}: \`${match[0]}${args})\` hands a client the whole dictionary — name a scope (lib/localeScopes.json)`,
        ).toBeTruthy();
        add(scope!, file);
      }
      for (const match of source.matchAll(/<JournalLocaleProvider\b[^>]*\bscope="([A-Za-z]+)"/g)) add(match[1], file);
    }
    return found;
  }

  it("names a scope at every call, and each scope only where the table says", () => {
    const found = sites();
    const expected = new Map<string, Set<string>>();
    for (const [name, scope] of Object.entries(SCOPES) as [string, { layout?: string; files?: string[]; at?: string[] }][]) {
      expected.set(name, new Set(scope.layout ? [scope.layout] : (scope.at ?? scope.files)));
    }
    const describeMap = (m: Map<string, Set<string>>) =>
      Object.fromEntries([...m].map(([k, v]) => [k, [...v].sort()]).sort(([a], [b]) => String(a).localeCompare(String(b))));
    expect(describeMap(found)).toEqual(describeMap(expected));
  });

  it("wraps a layout scope's children in its provider", () => {
    for (const [name, scope] of Object.entries(SCOPES) as [string, { layout?: string }][]) {
      if (!scope.layout) continue;
      const source = read(scope.layout);
      expect(
        /<(LocaleProvider|JournalLocaleProvider)\b[\s\S]*\{children\}[\s\S]*<\/\1>/.test(source),
        `${scope.layout} (scope "${name}") must render {children} inside its provider — the scope counts every page under it`,
      ).toBe(true);
    }
  });
});

describe("keys reach t() only in shapes the scan reads", () => {
  // A cast is the one way a string the scan never saw becomes a key. Each one
  // must be of a literal: a key, or a template whose head names its prefix
  // (`\`cost.cat.${c}\``), so the scan ships everything under it.
  const namespaces = new Set(
    Object.keys(JSON.parse(read("site/locales/en.json")) as Record<string, string>).map((k) => k.slice(0, k.indexOf("."))),
  );
  const readable = (literal: string) => {
    const head = /^([A-Za-z][A-Za-z0-9]*)\.[A-Za-z0-9_.-]*/.exec(literal.slice(1));
    return head !== null && namespaces.has(head[1]);
  };
  /** The literal a cast at `at` applies to, or null when it is not a literal. */
  const operandBefore = (source: string, at: number): string | null => {
    let end = at;
    while (end > 0 && /\s/.test(source[end - 1])) end--;
    const quote = source[end - 1];
    if (quote !== '"' && quote !== "'" && quote !== "`") return null;
    const start = source.lastIndexOf(quote, end - 2);
    return start < 0 ? null : source.slice(start, end);
  };

  it("casts to TranslationKey only literals with a namespace", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
      const source = read(file);
      const casts = [
        ...[...source.matchAll(/\bas\s+(?:unknown\s+as\s+)?TranslationKey\b/g)].map((m) => m.index),
        // `t(x as never)` is the same cast by another name.
        ...[...source.matchAll(/\b(?:t|tn)\(([^()]*?)\s+as never\)/g)].map((m) => m.index + m[0].length - " as never)".length),
      ];
      for (const at of casts) {
        const operand = operandBefore(source, at);
        if (operand === null || !readable(operand)) {
          const line = source.slice(0, at).split("\n").length;
          offenders.push(`${file}:${line}`);
        }
      }
    }
    expect(offenders, "type the value as TranslationKey where it is chosen, from literals, instead of casting").toEqual([]);
  });
});

describe("the scan", () => {
  const keys = ["a.b", "a.b.one", "a.bc", "cost.cat.food", "cost.cat.fuel", "cost.total", "nav.home"].sort();
  const namespaces = new Set(["a", "cost", "nav"]);

  it("reads a key with the singular beside it, but not a longer key that merely starts the same", () => {
    expect([...keysMentioned(`t("a.b")`, keys, namespaces)].sort()).toEqual(["a.b", "a.b.one"]);
  });

  it("reads a template's head, and a string ending in a dot, as a prefix", () => {
    expect([...keysMentioned("t(`cost.cat.${c}` as TranslationKey)", keys, namespaces)].sort()).toEqual([
      "cost.cat.food",
      "cost.cat.fuel",
    ]);
    expect([...keysMentioned(`t(("cost.cat." + c) as TranslationKey)`, keys, namespaces)]).toHaveLength(2);
  });

  it("ignores strings from no namespace, and the TranslationKey union itself", () => {
    const source = `const f = "next.config"; export type TranslationKey =\n  | "nav.home";\nconst g = 'nav.home';`;
    expect([...keysMentioned(source, keys, namespaces)]).toEqual(["nav.home"]);
    expect([...keysMentioned(`export type TranslationKey =\n  | "nav.home";\n`, keys, namespaces)]).toEqual([]);
  });

  it("follows runtime imports and skips type-only ones", () => {
    const source = [
      `import type { A } from "./types";`,
      `import B, { type C } from "@/components/B";`,
      `export { D } from "../d";`,
      `import "./side-effect";`,
      `const E = dynamic(() => import("./E"));`,
    ].join("\n");
    expect(importsOf(source)).toEqual(["@/components/B", "../d", "./side-effect", "./E"]);
  });
});

describe("dictionaryFor with a scope", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-scopes-"));
    process.env.CONTENT_DIR = dir;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.CONTENT_DIR;
    vi.doUnmock("@paid/manifest");
    vi.resetModules();
  });

  it("ships the scope's keys, each in the locale or else in English, and the same object every time", async () => {
    const { clearLocaleCache, dictionaryFor } = await import("@/lib/locales");
    clearLocaleCache();
    const scopes = JSON.parse(read("lib/localeScopes.json")) as Record<string, { keys: string[] }>;
    const english = dictionaryFor("en");
    const german = dictionaryFor("de");

    const journal = dictionaryFor("de", "journal");
    // With the private `paid/` clone mounted, a scope that reaches a paid area
    // ships the whole dictionary: the paid components' keys are not in the
    // scan (lib/locales.ts, dictionaryFor).
    const { PAID_AREAS } = await import("@paid/manifest");
    const paidAreas: readonly string[] = PAID_AREAS;
    if ((scopes.journal as { paid?: string[] }).paid?.some((area) => paidAreas.includes(area))) {
      expect(journal).toBe(german);
      return;
    }
    expect(Object.keys(journal).sort()).toEqual([...scopes.journal.keys].sort());
    for (const key of scopes.journal.keys) expect(journal[key]).toBe(german[key]);
    expect(Object.keys(journal).length).toBeLessThan(Object.keys(english).length / 3);
    // One object per (locale, scope), so a layout and a page asking for the
    // same one put it in the RSC payload once.
    expect(dictionaryFor("de", "journal")).toBe(journal);

    // A key English itself has no string for still ships: German's sentence
    // about a day written in English (`LocaleProvider`'s `fallbackNotice`).
    expect(journal["fallback.writtenIn.en"]).toBe(german["fallback.writtenIn.en"]);
    expect(journal["fallback.writtenIn.en"]).toBeTruthy();

    // A language with no dictionary of its own reads English for every key.
    const croatian = dictionaryFor("hr", "journal");
    for (const key of scopes.journal.keys) expect(croatian[key]).toBe(english[key]);
  });

  it("follows an instance's own override of a scoped string", async () => {
    const { clearLocaleCache, dictionaryFor } = await import("@/lib/locales");
    clearLocaleCache();
    const scopes = JSON.parse(read("lib/localeScopes.json")) as Record<string, { keys: string[] }>;
    const key = scopes.root.keys[0];
    fs.mkdirSync(path.join(dir, "locales"));
    fs.writeFileSync(path.join(dir, "locales", "en.json"), JSON.stringify({ [key]: "Overridden" }));
    expect(dictionaryFor("en", "root")[key]).toBe("Overridden");
  });

  it("ships a scope whole when its files reach a paid area this build carries", async () => {
    const scopes = JSON.parse(read("lib/localeScopes.json")) as Record<string, { paid: string[] }>;
    const [scope, { paid }] = Object.entries(scopes).find(([, s]) => s.paid.length > 0)!;
    vi.resetModules();
    vi.doMock("@paid/manifest", () => ({ PAID_AREAS: [paid[0]] }));
    const { clearLocaleCache, dictionaryFor } = await import("@/lib/locales");
    clearLocaleCache();
    expect(dictionaryFor("en", scope as never)).toBe(dictionaryFor("en"));
  });
});
