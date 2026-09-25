import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { translateIn } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";

/**
 * B2054 — every reader-grant mail went out headed "You can read {title}", in
 * all three languages: `sendGrantedMail` asked for the headline without the
 * variables its template names, and `translate` leaves an unfilled
 * placeholder in place rather than failing.
 *
 * This keeper renders every string any mail builder asks for, in en, de and
 * hu, with exactly the variables its call site passes, and fails on a
 * `{placeholder}` that survives. The builders are not listed here: every
 * file under lib/ or app/ that calls `renderMail(` or `sendMail(`, or is
 * named for mail, is one,
 * and every call in it whose argument is a translation key is a string of
 * that mail (subject, title, body, button, footer alike). A key chosen at
 * runtime (`const bodyKey = trip ? "a" : "b"`) is followed to its
 * declaration; a vars argument that is a variable (or a spread of one) is followed to
 * its object literal. A call whose variables cannot be read from the source
 * at all fails the keeper by name, so a new one is read by a person rather
 * than silently skipped.
 */

const ROOT = path.resolve(__dirname, "..");
const LOCALES = ["en", "de", "hu", "fr", "it"] as const;
const PLACEHOLDER = /\{[a-zA-Z]+\}/;
const english = JSON.parse(
  fs.readFileSync(path.join(ROOT, "site/locales/en.json"), "utf8"),
) as Record<string, string>;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(at);
    return /\.tsx?$/.test(entry.name) ? [at] : [];
  });
}

const mailFiles = ["lib", "app", ...(fs.existsSync(path.join(ROOT, "paid")) ? ["paid"] : [])]
  .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
  .filter((file) => {
    if (file.endsWith(path.join("lib", "mail", "template.ts"))) return false;
    if (file.endsWith(path.join("lib", "mail", "index.ts"))) return false;
    // A helper that builds part of a mail (`inviteMailNote.ts`, `dayMail.ts`)
    // is named for it even where it never sends.
    if (/mail/i.test(path.basename(file))) return true;
    return /\b(renderMail|sendMail)\(/.test(fs.readFileSync(file, "utf8"));
  });

type Use = { file: string; line: number; key: string; vars: string[] | null };

/** The `const name = …` a bare identifier refers to: the last one declared
 * before the use, which is the one in scope for every file here (two
 * handlers in one route may each have their own `vars`). */
function declarationOf(source: ts.SourceFile, name: string, before: number): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      node.getStart() < before &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every translation key a key expression can evaluate to. */
function keysOf(source: ts.SourceFile, expr: ts.Expression, depth = 0): string[] {
  if (ts.isStringLiteralLike(expr)) return expr.text in english ? [expr.text] : [];
  if (ts.isConditionalExpression(expr)) {
    return [...keysOf(source, expr.whenTrue, depth), ...keysOf(source, expr.whenFalse, depth)];
  }
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
    return keysOf(source, expr.expression, depth);
  }
  if (ts.isIdentifier(expr) && depth < 3) {
    const init = declarationOf(source, expr.text, expr.getStart());
    return init ? keysOf(source, init, depth + 1) : [];
  }
  return [];
}

/** The variable names an argument supplies, or null where the source cannot say. */
function varsOf(source: ts.SourceFile, expr: ts.Expression | undefined, depth = 0): string[] | null {
  if (!expr) return [];
  if (ts.isIdentifier(expr) && expr.text === "undefined") return [];
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
    return varsOf(source, expr.expression, depth);
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const names: string[] = [];
    for (const prop of expr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const spread = varsOf(source, prop.expression, depth);
        if (spread === null) return null;
        names.push(...spread);
        continue;
      }
      if (prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
        names.push(prop.name.text);
      } else {
        return null;
      }
    }
    return names;
  }
  if (ts.isConditionalExpression(expr)) {
    const a = varsOf(source, expr.whenTrue, depth);
    const b = varsOf(source, expr.whenFalse, depth);
    // Either branch may be the one taken; only names both supply are certain.
    return a && b ? a.filter((name) => b.includes(name)) : null;
  }
  if (ts.isIdentifier(expr) && depth < 3) {
    const init = declarationOf(source, expr.text, expr.getStart());
    return init ? varsOf(source, init, depth + 1) : null;
  }
  return null;
}

function usesIn(file: string): Use[] {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const uses: Use[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      node.arguments.forEach((arg, i) => {
        // A string literal argument that is not a translation key, or an
        // identifier that resolves to none, is not a mail string.
        const keys = keysOf(source, arg);
        if (keys.length === 0) return;
        const vars = varsOf(source, node.arguments[i + 1]);
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        for (const key of keys) uses.push({ file: path.relative(ROOT, file), line, key, vars });
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

const uses = mailFiles.flatMap(usesIn);

describe("every mail builder's strings render without a leftover {placeholder}", () => {
  test("the builders are found from the source, not listed", () => {
    // The files this keeper exists for; if it stops finding them, the
    // derivation broke rather than the mails got fixed.
    const files = new Set(uses.map((use) => use.file));
    expect(files).toContain(path.join("lib", "contacts", "mail.ts"));
    if (fs.existsSync(path.join(ROOT, "paid"))) expect(files).toContain(path.join("paid", "credits", "lib", "credits", "receipt.ts"));
    expect(files.size).toBeGreaterThanOrEqual(10);
    expect(uses.length).toBeGreaterThan(100);
  });

  test("every call's variables can be read from the source", () => {
    const unreadable = uses.filter((use) => use.vars === null);
    expect(unreadable.map((use) => `${use.file}:${use.line} ${use.key}`)).toEqual([]);
  });

  for (const locale of LOCALES) {
    test(`${locale}: every string is filled`, () => {
      const leftovers: string[] = [];
      for (const use of uses) {
        if (use.vars === null) continue;
        const fixture = Object.fromEntries(use.vars.map((name) => [name, `«${name}»`]));
        const rendered = translateIn(locale, use.key as TranslationKey, fixture);
        if (PLACEHOLDER.test(rendered)) {
          leftovers.push(`${use.file}:${use.line} ${use.key} → ${rendered}`);
        }
      }
      expect(leftovers).toEqual([]);
    });
  }
});
