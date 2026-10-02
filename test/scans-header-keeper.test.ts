// @scans test/**, paid/test/**
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B2711 — `scripts/check-changed.mjs` picks its static keepers from each
 * test's own `// @scans <globs>` header, not a hand-kept list. This is the
 * keeper for the header itself: a test that reads a real source directory
 * off disk (not a fixture it built itself) but carries no header is a
 * keeper `check:changed` will silently never run, the exact failure this
 * ticket was filed for.
 *
 * A false negative here (missing a test that should have a header) is
 * cheap — `check:changed` just won't select it, the same gap as before this
 * ticket. A false positive is expensive — a file flagged for merely writing
 * `"app"` into a temp-directory name — so the heuristic looks for an
 * `fs.readdirSync`/`globSync` call AND a literal path straight off one of
 * the real source trees AND a reference to the repository root
 * (`process.cwd()`, `import.meta.dirname`, `__dirname`, or a `ROOT`
 * constant) somewhere in the same file. A fixture test's own temp directory
 * (`fs.mkdtempSync`, a `mediaRoot()`/`mailRoot()` helper) never satisfies
 * that last part.
 *
 * If this test fails for a new file, the fix is the one-line header, not a
 * change here:
 *
 *   // @scans components/studio/**, site/locales/*.json
 *
 * — first line of the file, or the second when a `// @vitest-environment`
 * pragma has to stay first. List every top-level path the test reads to
 * decide whether it still passes; `check-changed.mjs` globs changed paths
 * against exactly that list (`**` is any number of path segments, `*` is
 * one, everything else — including `[user]` — is literal).
 */

const ROOT = process.cwd();
const TEST_DIRS = ["test", "paid/test"];

const SCAN_CALL = /\b(?:readdirSync|globSync)\s*\(/;
const ROOT_LIKE = /(?:\bROOT\b|process\.cwd\(\)|import\.meta\.dirname|__dirname)/;
// A quoted literal that names a real source tree, as a whole first path
// segment — "app/…", "app" alone, "lib/…", and so on. Deliberately narrow:
// "apple" or "libxyz" must not match.
const SOURCE_LITERAL =
  /["'`](?:\.claude\/skills|\.agents\/skills|app(?:\/[^"'`]*)?|components(?:\/[^"'`]*)?|lib(?:\/[^"'`]*)?|site\/(?:locales|legal|config\.json)[^"'`]*|docs(?:\/[^"'`]*)?|scripts(?:\/[^"'`]*)?|public(?:\/[^"'`]*)?|paid(?:\/[^"'`]*)?|content\/example[^"'`]*|deploy\/[^"'`]*)["'`]/;
// `path.join(...)`/`path.resolve(...)` calls, each checked on its own —
// requiring the repo-root reference and the source literal to be arguments
// of the *same* call is what keeps a fixture test's own temp directory
// (built from `os.tmpdir()`, a `mediaRoot()` helper, or a loop variable) out
// of this: the root and the real path only count together when a call
// actually joins them, not merely because both appear somewhere in the file.
// Allows one level of nested parens so `path.join(process.cwd(), "app")`
// does not get cut off at `process.cwd(`'s own closing paren.
const JOIN_CALL = /path\s*\.\s*(?:join|resolve)\s*\(((?:[^()]|\([^()]*\))*)\)/g;

function joinsRootToSource(text: string): boolean {
  for (const match of text.matchAll(JOIN_CALL)) {
    const args = match[1];
    if (ROOT_LIKE.test(args) && SOURCE_LITERAL.test(args)) return true;
  }
  return false;
}

function testFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

function hasScansHeader(text: string): boolean {
  const lines = text.split("\n", 3);
  return lines.slice(0, 2).some((line) => /^\s*\/\/\s*@scans\s+\S/.test(line));
}

function scansTheSourceTree(text: string): boolean {
  return SCAN_CALL.test(text) && joinsRootToSource(text);
}

describe("every test that reads the source tree declares what it scans", () => {
  test("no test file both reads a source directory and lacks an @scans header", () => {
    const files = TEST_DIRS.flatMap(testFiles);
    const offenders = files
      .filter((file) => file !== path.join(ROOT, "test", "scans-header-keeper.test.ts"))
      .map((file) => ({ file, text: fs.readFileSync(file, "utf8") }))
      .filter(({ text }) => scansTheSourceTree(text) && !hasScansHeader(text))
      .map(({ file }) => path.relative(ROOT, file).split(path.sep).join("/"));

    expect(
      offenders,
      offenders.length > 0
        ? `each file below reads a source directory with no declared reason; add, as its first line ` +
            `(or its second, right after a '// @vitest-environment' pragma), a header naming every ` +
            `top-level path it scans, e.g.:\n\n  // @scans components/studio/**, site/locales/*.json\n\n` +
            `so scripts/check-changed.mjs can select it:\n${offenders.map((f) => `  ${f}`).join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  test("every declared @scans header still names a real source path", () => {
    // An open-repo test is allowed to name a `paid/…` path in its own header
    // (it reads `paid/` only when present, same as the test itself does at
    // runtime) — but public CI has no `paid/` checkout at all, so a `paid`
    // base cannot be held to "exists on disk" there. Everything else stays
    // strict: a real clone always has `app`, `components`, `lib`, and so on.
    const paidPresent = fs.existsSync(path.join(ROOT, "paid"));
    const skillsPresent = fs.existsSync(path.join(ROOT, ".claude/skills"));
    const files = TEST_DIRS.flatMap(testFiles);
    const bad: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split("\n", 3);
      const header = lines.slice(0, 2).find((line) => /^\s*\/\/\s*@scans\s+\S/.test(line));
      if (!header) continue;
      const globs = header.replace(/^\s*\/\/\s*@scans\s+/, "").split(",").map((g) => g.trim());
      for (const glob of globs) {
        const base = glob.split("*")[0].replace(/\/+$/, "");
        if (!base) continue;
        if (!paidPresent && (base === "paid" || base.startsWith("paid/"))) continue;
        // .claude/skills is a gitignored link to the harness, absent on CI.
        if (!skillsPresent && base.startsWith(".claude/skills")) continue;
        if (!fs.existsSync(path.join(ROOT, base)) && !fs.existsSync(path.join(ROOT, path.dirname(base)))) {
          bad.push(`${path.relative(ROOT, file)}: @scans path does not exist: ${glob}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
