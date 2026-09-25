import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { contentRoot } from "./contentRoot";
import { siteRoot } from "./siteRoot";

/**
 * The instance's own legal page — imprint, liability, privacy.
 *
 * Markdown under `site/legal/<locale>.md`, and deliberately **not** under
 * `docs/`: this is the operator's statement about their own company, their own
 * hosting and their own sub-processors, and a fork that inherited it would be
 * publishing somebody else's imprint under its own domain. That is also why
 * nothing here is in the locale files or in a component:
 * `test/depersonalised.test.ts` fails the build over a real name in `lib/`,
 * `app/` or `components/`, and an imprint is nothing but real names.
 *
 * It sits in the checkout rather than under `CONTENT_DIR` because an imprint
 * has to *reach* production to be worth writing, and `git pull` is the only
 * thing that reliably does that — B56 is what the alternative cost. A fork
 * deletes `site/legal/` and writes its own; an instance that would rather keep
 * its imprint out of the repository puts one under `CONTENT_DIR`, which still
 * wins. B510.
 *
 * Absent by default, like every optional capability: an instance with no
 * `legal/` in either place has no page and no footer link, rather than a page
 * that renders an empty promise.
 */
/** The instance's own imprint if it has one, otherwise the checkout's. */
function legalDir(): string {
  const own = path.join(contentRoot(), "legal");
  return fs.existsSync(own) ? own : path.join(siteRoot(), "legal");
}

export function legalLocales(): string[] {
  try {
    return fs
      .readdirSync(legalDir())
      .filter((f) => /^[a-z]{2}\.md$/.test(f))
      .map((f) => f.slice(0, 2))
      .sort();
  } catch {
    return [];
  }
}

export function hasLegal(): boolean {
  return legalLocales().length > 0;
}

/**
 * The page in the best language available, and which language that turned out
 * to be — the caller says so rather than presenting a fallback as though it
 * were the translation, the same bargain `readGuide` makes.
 *
 * English is the first fallback, then whatever else exists: an operator who
 * wrote only `de.md` should get their German imprint served to an English
 * reader, not a 404. Null when there is nothing at all.
 */
export type Legal = {
  markdown: string;
  locale: string;
  /** `updated:` from the front matter, as `YYYY-MM-DD`. Never the file's
   * mtime: a deploy rewrites that, and the page would claim a review that
   * never happened. Absent when the operator wrote none. */
  updated?: string;
  /** `summary:` from the front matter — the "In short" list. B2313. */
  summary?: string[];
};

export function readLegal(locale: string): Legal | null {
  // The locale reaches here from a cookie, so it is checked rather than
  // trusted — this is the argument to a `path.join`.
  const asked = /^[a-z]{2}$/.test(locale) ? locale : "en";
  for (const code of [asked, "en", ...legalLocales()]) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(legalDir(), `${code}.md`), "utf-8");
    } catch {
      continue; // Next candidate.
    }
    const { data, content } = matter(raw);
    // YAML reads a bare 2026-09-25 as a Date; a quoted one stays a string.
    const updated =
      data.updated instanceof Date ? data.updated.toISOString().slice(0, 10) : data.updated;
    const summary = Array.isArray(data.summary)
      ? data.summary.filter((line: unknown): line is string => typeof line === "string")
      : [];
    return {
      markdown: content,
      locale: code,
      ...(typeof updated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(updated) ? { updated } : {}),
      ...(summary.length ? { summary } : {}),
    };
  }
  return null;
}

/**
 * The page's `##` sections, for its contents list and their anchors — B2313.
 *
 * `## Your data {#privacy}` fixes the anchor, so a link that has to outlive
 * edits and translations (the App Store's privacy-policy URL is
 * `/legal#privacy`) says which section it means in every language. Without
 * one the anchor is a slug of the heading. Returns the markdown with the
 * `{#…}` markers taken out, since markdown itself has no such syntax.
 */
export function legalSections(markdown: string): {
  markdown: string;
  /** `line` is 1-based, as the markdown parser reports a heading's position. */
  sections: { id: string; title: string; line: number }[];
} {
  const sections: { id: string; title: string; line: number }[] = [];
  const body = markdown.replace(
    /^## +(.+?)(?: *\{#([a-z0-9-]+)\})? *$/gm,
    (_, title: string, id: string | undefined, offset: number) => {
      const line = markdown.slice(0, offset).split("\n").length;
      sections.push({ id: id ?? slug(title), title, line });
      return `## ${title}`;
    },
  );
  return { markdown: body, sections };
}

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
