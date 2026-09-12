import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The v2 import boundary — `docs/v2-migration/README.md`: "Contract layer
 * new, domain layer shared: a v2 route is schema.parse → existing domain
 * function → full-document echo. Never import v1 route glue."
 *
 * Two rules, enforced on every file under `app/api/v2/**` and
 * `lib/api/v2/**`:
 *
 * 1. Nothing there imports from `app/` at all — a v2 route must never reach
 *    into another route file's glue, and there is no allowlist for this one.
 * 2. Nothing there imports from `lib/api/` unless the module is on
 *    `LIB_API_ALLOWLIST` below, or is itself under `lib/api/v2/`.
 *
 * `lib/api/` is where v1's route glue lives — request parsing, response
 * shaping, the things a *route* does rather than the things a *domain*
 * function does. A name goes on the allowlist when the module is a domain
 * function (it computes or writes content) that v1 and v2 both have reason to
 * share; a module that turns out to be route glue gets extracted out from
 * under `lib/api/` (or into `lib/api/v2/` if it is v2's own), never
 * allowlisted in place.
 */

/**
 * Grows as v2 routes are built and legitimately need to share something with
 * v1. Written as paths relative to the repo root, without extension, so a
 * `.ts`/`.tsx`/`/index` on either side of the comparison does not matter.
 */
const LIB_API_ALLOWLIST = [
  // The one error vocabulary — every route, v1 or v2, answers refusals from
  // the same set of codes rather than inventing its own strings.
  "lib/api/errorCodes",
];

const ROOT = process.cwd();
const SCAN_DIRS = ["app/api/v2", "lib/api/v2"];

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `^import … from "X"`, `export … from "X"`, and dynamic `import("X")` —
 * enough to catch every import shape in this codebase without a parser
 * dependency. Deliberately does not catch a bare side-effect `import "X"`
 * with no `from`, which nothing under app/api or lib/api writes. */
const IMPORT_FROM = /^\s*import\s[\s\S]*?\sfrom\s+["']([^"']+)["']/gm;
const EXPORT_FROM = /^\s*export\s[\s\S]*?\sfrom\s+["']([^"']+)["']/gm;
// A backtick-quoted specifier with no `${…}` interpolation is a perfectly
// static string — ``import(`@/lib/api/tripDetails`)`` resolves exactly like
// its single-quoted twin — and the old `["']` class made it invisible to
// this rule (B1601, moderate finding 5). Interpolation inside the backticks
// still will not match: a specifier that is not a literal at scan time is
// not a violation this static check can prove either way.
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const re of [IMPORT_FROM, EXPORT_FROM, DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(re)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** A specifier as it resolves against the repo root, without extension —
 * `@/lib/api/errorCodes` and `../../api/errorCodes` from a file two levels
 * under `lib/api/v2/schemas/` both land on `lib/api/errorCodes`. A bare
 * specifier (`react`, `zod`, `next/server`) resolves to itself and is never a
 * violation, since neither rule below can ever match it. */
function resolveSpecifier(specifier: string, fromFile: string): string {
  let resolved: string;
  if (specifier.startsWith("@/")) {
    resolved = path.join(ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    resolved = path.join(path.dirname(fromFile), specifier);
  } else {
    return specifier;
  }
  const rel = path.relative(ROOT, resolved).split(path.sep).join("/");
  return rel.replace(/\/index$/, "").replace(/\.(ts|tsx)$/, "");
}

export type Violation = { file: string; specifier: string; resolved: string };

/** The rule itself, pulled out of the filesystem walk so it can be proven
 * against synthetic source before it is trusted against the real tree — a
 * test that only ever sees an empty `app/api/v2/` cannot tell a working rule
 * from a rule that silently matches nothing. */
export function findViolations(fromFile: string, source: string): Violation[] {
  const violations: Violation[] = [];
  for (const specifier of extractSpecifiers(source)) {
    const resolved = resolveSpecifier(specifier, fromFile);
    if (resolved === specifier && !specifier.startsWith("@/") && !specifier.startsWith(".")) {
      continue; // a bare package specifier, not a path into this repo
    }
    if (resolved === "app" || resolved.startsWith("app/")) {
      violations.push({ file: fromFile, specifier, resolved });
      continue;
    }
    if (resolved === "lib/api" || resolved.startsWith("lib/api/")) {
      if (resolved.startsWith("lib/api/v2/") || resolved === "lib/api/v2") continue;
      if (LIB_API_ALLOWLIST.includes(resolved)) continue;
      violations.push({ file: fromFile, specifier, resolved });
    }
  }
  return violations;
}

describe("the v2 import boundary", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  test("proves the rule against a violation before trusting it against an empty tree", () => {
    // If app/api/v2 has nothing in it yet, a rule that always answers "no
    // violations" would pass right alongside a working one. This is the
    // synthetic case that only the working one catches.
    const fake = path.join(ROOT, "lib/api/v2/fake-for-this-test.ts");
    const badImports = [
      'import { doThing } from "@/app/api/v1/something/route";',
      'import { doThing } from "../../../app/api/v1/something/route";',
      'import { helper } from "@/lib/api/tripDetails";',
      'export { helper } from "../tripDetails";',
      'const mod = await import("@/lib/api/tripDetails");',
      "const mod = await import(`@/lib/api/tripDetails`);",
    ];
    for (const source of badImports) {
      expect(findViolations(fake, source), source).not.toEqual([]);
    }

    const goodImports = [
      'import { z } from "zod";',
      'import { CODE } from "@/lib/api/errorCodes";',
      'import { schema } from "./schemas/status";',
      'import { entriesFor } from "@/lib/entries";',
    ];
    for (const source of goodImports) {
      expect(findViolations(fake, source), source).toEqual([]);
    }
  });

  test("nothing under app/api/v2 or lib/api/v2 imports route glue from app/ or lib/api/ outside the allowlist", () => {
    const violations = files.flatMap((file) =>
      findViolations(file, fs.readFileSync(file, "utf8")).map(
        (v) => `${path.relative(ROOT, v.file)}: imports "${v.specifier}" (resolves to ${v.resolved})`,
      ),
    );
    expect(
      violations,
      "a v2 route/module must go through a domain function, not v1 route glue — extract the shared logic into lib/api/v2/ or add it to LIB_API_ALLOWLIST if it is genuinely a domain function",
    ).toEqual([]);
  });

  /**
   * `app/api/v2` was empty through B1596 (the plumbing, built before any
   * route landed) and the first real routes arrived in phase 2 step 3
   * (B1609: the figure library). The synthetic test above is what proves the
   * boundary rule works even when this directory is empty — this one no
   * longer asserts emptiness, since asserting it forever would make this
   * suite fail the moment the very routes it protects are added.
   */
  test("the walk finds real files under app/api/v2 once routes exist", () => {
    const appV2Files = walk(path.join(ROOT, "app/api/v2"));
    expect(appV2Files.length).toBeGreaterThan(0);
  });
});
