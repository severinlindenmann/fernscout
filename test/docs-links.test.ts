// @scans docs/**, .claude/skills/**, README.md, AGENTS.md, CONTRIBUTING.md
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The link test.
 *
 * `AGENTS.md` tells every reader that prose about the software "is in
 * `docs/`, indexed from the README" — so the README is the one path a
 * newcomer is told to follow, and on 2026-09-01 a directory move left every
 * row of its documentation table pointing at nothing. Ten dead links in the
 * first document anybody opens, and on github.com they are 404s rather than
 * something a reader can guess past. It was captured three separate times
 * before anybody fixed it: B09, B62, B198.
 *
 * Two different failures, so two tests.
 *
 * The first is the ordinary one: a markdown link whose target has moved. The
 * second is the expensive one — a code comment citing a document for the
 * reasoning behind a decision. When that file is gone the comment does not
 * merely fail to open; it becomes folklore, a claim with nothing behind it,
 * and the next person reads it as if somebody had checked.
 */

const ROOT = process.cwd();

function markdownFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        out.push(path.relative(ROOT, full));
      }
    }
  };
  const abs = path.join(ROOT, dir);
  if (fs.existsSync(abs)) walk(abs);
  return out;
}

/** `[text](target)` and `![alt](target)`, with an optional "title" after it. */
const MARKDOWN_LINK = /!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/**
 * Two directories under `docs/` are records rather than documentation, and
 * both legitimately name a path that is not there.
 *
 * `tasks/` is the finding, written at the moment it was found — several task
 * files quote a link that was broken *as the evidence*, and this test failing
 * on the quotation would be the tail wagging the dog. `plans/` is intent as
 * written before the work and is deliberately never updated, so a path in one
 * describes what somebody meant to build. Tasks reference each other by id and
 * never by path (see `AGENTS.md`), which is what makes excluding them safe.
 */
const RECORDS = [path.join("docs", "tasks"), path.join("docs", "plans")];

/**
 * These top-level `docs/` directories are process material moving to the
 * private harness (B2251, `open-core/harness-move.md`), not the app.
 * `docs/benchmarks` deliberately stays with the app and is not listed here.
 * While one of these directories still exists on disk (today, and until the
 * physical move actually runs), a link or citation into it is checked exactly
 * as before — nothing here weakens today's gate. Once the move has happened
 * and the whole directory is gone from the app repo, a reference into it
 * stops being this repo's problem to keep truthful, so it is treated as
 * external rather than broken.
 */
const HARNESS_DOCS_DIRS = [
  "tasks",
  "plans",
  "superpowers",
  "security",
  "qa",
  "compliance",
  "app-store",
  "v2-migration",
  "providers",
  "bugs",
  "agents",
  "benchmarks",
];

/** True when `repoRelativePath` (e.g. a file under `docs` + `/security/`)
 * names a path under a harness-bound docs directory that no longer exists on
 * disk. */
function pointsIntoAbsentHarnessDir(repoRelativePath: string): boolean {
  const normalized = repoRelativePath.split(path.sep).join("/");
  return HARNESS_DOCS_DIRS.some((dir) => {
    const prefix = `docs/${dir}`;
    if (normalized !== prefix && !normalized.startsWith(`${prefix}/`)) return false;
    return !fs.existsSync(path.join(ROOT, prefix));
  });
}

describe("relative links in markdown resolve", () => {
  const files = [
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    ...markdownFilesUnder("docs").filter(
      (f) => !RECORDS.some((dir) => f.startsWith(dir + path.sep)),
    ),
    ...markdownFilesUnder(".claude/skills"),
  ].filter((f) => fs.existsSync(path.join(ROOT, f)));

  test("there is something to check", () => {
    // A glob that silently matches nothing is a test that silently passes.
    expect(files.length).toBeGreaterThan(20);
  });

  test.each(files)("%s", (file) => {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const broken: string[] = [];

    for (const match of text.matchAll(MARKDOWN_LINK)) {
      const href = match[1];
      // External, in-page, and the `<…>` form angle-bracket links.
      if (/^(https?:|mailto:|tel:|#|<)/.test(href)) continue;
      const target = href.split("#")[0];
      if (!target) continue;
      /**
       * A root-relative href is a **URL on this site**, not a path on disk,
       * so resolving it against the file's directory would check the wrong
       * thing — and `path.resolve` would happily walk out of the repository
       * to do it. Such a URL is a route, and a route is not this test's
       * business.
       */
      const resolved = target.startsWith("/")
        ? null
        : path.resolve(path.dirname(path.join(ROOT, file)), target);
      if (resolved && !fs.existsSync(resolved) && !pointsIntoAbsentHarnessDir(path.relative(ROOT, resolved))) {
        broken.push(href);
      }
    }

    expect(broken, `${file} links to files that do not exist`).toEqual([]);
  });
});

describe("backtick paths in docs/*.md resolve", () => {
  /**
   * The direct children of `docs/` only (not `docs/testing/`, `docs/guides/`,
   * …) — the top-level prose files, which is what "docs/*.md" names. A
   * backtick path here was never checked at all before this test existed:
   * `test/docs-links.test.ts` only ever read `[text](target)` syntax, so a
   * path quoted as `` `some/path.ts` `` could go stale forever with the
   * suite green. This is deliberately stricter than the harness-dir
   * exemption below the markdown-link check: no absent-harness-dir amnesty,
   * because this check is new and has never let anything pass yet.
   */
  const files = fs
    .readdirSync(path.join(ROOT, "docs"), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join("docs", e.name));

  /**
   * A source directory this repository actually has — the only prefixes
   * worth resolving. `site/`, `content/`, `deploy/` and `.data/`-style
   * backtick paths are excluded on purpose: those directories are full of
   * illustrative examples (`content/config.json`, `.data/mail/`, an example
   * exported file) that were never meant to name a file actually committed
   * here, and flagging every one would make this check noise rather than
   * signal. `lib/`, `app/`, `components/`, `scripts/` and `test/` paths are
   * always meant literally.
   */
  const REAL_PREFIXES = ["lib/", "app/", "components/", "scripts/", "test/", "docs/"];

  /** A backtick-quoted path under one of `REAL_PREFIXES`, ending in a real
   * source extension — excludes a placeholder segment like `<trip>` or
   * `YYYY-MM-DD-slug` that a route pattern or example uses on purpose. */
  const BACKTICK_PATH = /`((?:lib|app|components|scripts|test|docs)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+)`/g;
  const PLACEHOLDER = /[A-Z]{2,}|[<>]|YYYY/;

  test.each(files)("%s", (file) => {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const broken: string[] = [];

    for (const match of text.matchAll(BACKTICK_PATH)) {
      const target = match[1];
      if (!REAL_PREFIXES.some((p) => target.startsWith(p))) continue;
      if (PLACEHOLDER.test(target)) continue;
      const resolved = path.resolve(ROOT, target);
      if (!fs.existsSync(resolved) && !pointsIntoAbsentHarnessDir(target)) broken.push(target);
    }

    expect(broken, `${file} quotes paths in backticks that do not exist`).toEqual([]);
  });
});

describe("every docs/ path cited from code, skills or the README exists", () => {
  function filesUnder(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(full);
        } else if (/\.(ts|tsx|mts|mjs|js|sh|yml|yaml|md)$/.test(entry.name)) {
          out.push(path.relative(ROOT, full));
        }
      }
    };
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) walk(abs);
    return out;
  }

  /**
   * Where a citation is worth something. `docs/` itself is not scanned: a plan
   * is the record of intent as written before the work and is deliberately not
   * updated, so a path inside one is history rather than a promise.
   *
   * `components/`, `proxy.ts`, `instrumentation.ts` and `next.config.ts` were
   * added by B2415 (the docs audit's Part E) — components carry the same
   * kind of doc-citing comments as `lib/` and `app/` and were simply never
   * scanned.
   */
  const SOURCES = [
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "proxy.ts",
    "instrumentation.ts",
    "next.config.ts",
    ...markdownFilesUnder(".claude/skills"),
    ...filesUnder("lib"),
    ...filesUnder("app"),
    ...filesUnder("components"),
    ...filesUnder("scripts"),
    ...filesUnder("test"),
    ...filesUnder("deploy"),
    ...filesUnder(".github"),
  ].filter((f) => fs.existsSync(path.join(ROOT, f)));

  /**
   * A `docs/…` path in prose or a comment. Trailing punctuation is trimmed —
   * "see docs/runbook.md." names a file, not a file called `runbook.md.`.
   *
   * Not preceded by `/` or a word character (B305): a bare `\b` reads the
   * tail end of `app/docs/page.tsx` — a real route this repository has had
   * since B305 — as a citation of a `docs/`-folder file that is not there.
   * Excluding a `/`-led match also keeps this test out of the way of the
   * `/docs/api` URL and its siblings, which name a route rather than a file.
   * Every citation this test actually exists to catch is written as a bare
   * repo-relative path — `docs/runbook.md`, never with a leading slash —
   * which neither exclusion touches.
   */
  const DOCS_PATH = /(?<![/\w])docs\/[A-Za-z0-9._/-]+/g;

  test("no citation leads nowhere", () => {
    const broken = new Map<string, string[]>();

    for (const file of SOURCES) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const match of text.matchAll(DOCS_PATH)) {
        const cited = match[0].replace(/[.,;:)`"'\]]+$/, "");
        // `docs/tasks/backlog/` and friends are named as directories all over
        // the place; the directory existing is the whole claim.
        if (fs.existsSync(path.join(ROOT, cited))) continue;
        // A citation into a directory that has moved to the harness and is
        // genuinely no longer part of this repository is external, not broken.
        if (pointsIntoAbsentHarnessDir(cited)) continue;
        const list = broken.get(cited) ?? [];
        list.push(file);
        broken.set(cited, list);
      }
    }

    expect(
      Object.fromEntries(broken),
      "these paths are cited but do not exist — move the file back, repoint " +
        "the citation, or inline the reasoning it was standing in for",
    ).toEqual({});
  });
});
