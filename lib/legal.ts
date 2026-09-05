import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";

/**
 * The instance's own legal page — imprint, liability, privacy.
 *
 * Markdown under `content/legal/<locale>.md`, and deliberately **not** under
 * `docs/`: this is the operator's statement about their own company, their own
 * hosting and their own sub-processors, and a fork that inherited it would be
 * publishing somebody else's imprint under its own domain. `content/` is the
 * folder whose whole promise is that you delete it and drop in your own, which
 * is exactly the promise this text needs. It is also why nothing here is in
 * the locale files or in a component: `test/depersonalised.test.ts` fails the
 * build over a real name in `lib/`, `app/` or `components/`, and an imprint is
 * nothing but real names.
 *
 * Absent by default, like every optional capability: an instance with no
 * `content/legal/` has no page and no footer link, rather than a page that
 * renders an empty promise.
 */
export function legalLocales(): string[] {
  try {
    return fs
      .readdirSync(path.join(contentRoot(), "legal"))
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
export function readLegal(locale: string): { markdown: string; locale: string } | null {
  // The locale reaches here from a cookie, so it is checked rather than
  // trusted — this is the argument to a `path.join`.
  const asked = /^[a-z]{2}$/.test(locale) ? locale : "en";
  for (const code of [asked, "en", ...legalLocales()]) {
    try {
      const file = path.join(contentRoot(), "legal", `${code}.md`);
      return { markdown: fs.readFileSync(file, "utf-8"), locale: code };
    } catch {
      // Next candidate.
    }
  }
  return null;
}
