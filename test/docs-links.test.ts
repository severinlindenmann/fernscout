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
      const resolved = path.resolve(path.dirname(path.join(ROOT, file)), target);
      if (!fs.existsSync(resolved)) broken.push(href);
    }

    expect(broken, `${file} links to files that do not exist`).toEqual([]);
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
   */
  const SOURCES = [
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    ...markdownFilesUnder(".claude/skills"),
    ...filesUnder("lib"),
    ...filesUnder("app"),
    ...filesUnder("scripts"),
    ...filesUnder("test"),
    ...filesUnder("deploy"),
    ...filesUnder(".github"),
  ];

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
