import fs from "node:fs";
import path from "node:path";
import type { TranslationKey } from "./i18n";

/**
 * The `/docs` page's content strategy, for the parts that can honestly be
 * generated: read it off `README.md` and `CONTRIBUTING.md` at request time
 * rather than write a second copy that drifts from them (B23 makes the same
 * argument about `docs/` itself — a reference kept in two places disagrees
 * with itself within a month). Not everything on the page comes from here —
 * the "what to give it" guidance is written for the page directly, because
 * the file it would otherwise have been pulled from (`docs/ingest.md`)
 * described a pipeline this page does not want to promise (B306).
 */

/** A file already in the repository, read fresh so an edit to it reaches the
 * page with no build step of its own. `process.cwd()` is the repo root in
 * every deployment this project has — see AGENTS.md: the VPS runs a full
 * `git checkout` under `npm start`, not a pruned standalone bundle. */
export function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/**
 * One `## Heading` section of a markdown file, body only.
 *
 * Matches the heading text exactly (case-sensitive, as written), and returns
 * everything up to the next heading of the same or a higher level — a `###`
 * inside the section stays in. Throws rather than returning an empty string
 * on a miss, because a silently empty section on a public page is worse than
 * a build that fails: `test/docs.test.ts` is what catches a heading this
 * relies on being renamed out from under it.
 */
export function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    throw new Error(`section "${heading}" not found`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return rest.slice(0, end === -1 ? undefined : end).join("\n").trim();
}

/**
 * The three reader guides — B445.
 *
 * Prose for people rather than for agents: what a guest can do, what an owner
 * decides, what somebody on a trip may write. Markdown files under
 * `docs/guides/<locale>/`, read at request time like everything else on this
 * page, so correcting a sentence is an edit rather than a release.
 *
 * **Translated, unlike the rest of `/docs`.** The other pages here are for
 * somebody deciding whether to self-host or send a patch, and English is a
 * fair assumption for them. The guest guide's reader is a family member who
 * was sent a link and is not sure what they are looking at — writing that one
 * in a language they do not read would be writing it for nobody.
 */
export const GUIDES = ["guest", "creator", "buddy"] as const;
export type Guide = (typeof GUIDES)[number];

export function isGuide(value: string): value is Guide {
  return (GUIDES as readonly string[]).includes(value);
}

/**
 * One guide, in the best language available.
 *
 * Falls back to English rather than failing: a missing translation should cost
 * a reader the language, never the page. The caller is told which language it
 * actually got, so it can say so rather than quietly presenting English as
 * though it were the translation.
 */
export function readGuide(guide: Guide, locale: string): { markdown: string; locale: string } {
  /**
   * The locale is a path segment, so it is checked rather than trusted.
   *
   * Today it can only be two letters — `proxy.ts` matches `LANGUAGE_TAG` and
   * slices to two before the cookie is ever written — so this guards nothing
   * that is currently reachable. It is here because the guarantee lives three
   * files away from the `path.join` that depends on it, and a future caller
   * passing a header straight through would turn this into a file read of its
   * choosing. `guide` needs no such guard: it comes from `isGuide`, which is a
   * whitelist of three literals.
   */
  const asked = /^[a-z]{2}$/.test(locale) ? locale : "en";
  for (const code of [asked, "en"]) {
    try {
      return { markdown: readRepoFile(`docs/guides/${code}/${guide}.md`), locale: code };
    } catch {
      // Next candidate. A guide with no English copy either is a broken
      // build, and the throw below is the right way to find out.
    }
  }
  throw new Error(`no copy of the "${guide}" guide, in any language`);
}

/**
 * Every documentation page, once — B470.
 *
 * The hub renders these as cards and the inner pages render them as a nav, and
 * both read this list. Before it existed the guides were an array in one
 * component and the technical sections were anchors hand-written in another,
 * which is exactly how they came to be drawn as the same kind of control while
 * behaving differently — one navigated, one scrolled.
 *
 * The `group` is the axis the old page flattened: **who you are** (a reader, an
 * owner, somebody who was on the trip) against **what you want to build**
 * (host it, change it, call it). Keeping the two apart is what lets the hub
 * say, in the reader's own language, that only one of the halves is
 * translated.
 */
export type DocsPageId = Guide | "hosting" | "contributing" | "api";

export type DocsPage = {
  id: DocsPageId;
  href: string;
  /** Resolved by whoever renders it, never here — this module is imported by
   * server components that already hold a locale. Typed rather than left as a
   * `string` so a renamed key fails the typecheck here instead of rendering
   * the key itself onto the page. */
  labelKey: TranslationKey;
  group: "guides" | "technical";
};

export const DOCS_PAGES: readonly DocsPage[] = [
  { id: "guest", href: "/docs/guide/guest", labelKey: "guides.guest.title", group: "guides" },
  { id: "creator", href: "/docs/guide/creator", labelKey: "guides.creator.title", group: "guides" },
  { id: "buddy", href: "/docs/guide/buddy", labelKey: "guides.buddy.title", group: "guides" },
  { id: "hosting", href: "/docs/hosting", labelKey: "docs.hosting.title", group: "technical" },
  {
    id: "contributing",
    href: "/docs/contributing",
    labelKey: "docs.contributing.title",
    group: "technical",
  },
  { id: "api", href: "/docs/api", labelKey: "docs.api.title", group: "technical" },
];

/**
 * The same list, shaped for `DocsNav`, with the group boundary marked.
 *
 * Returns a structural shape rather than importing `DocsNavEntry`: `lib/` does
 * not import from `components/`, and the two would be the same type anyway.
 */
export function docsNavEntries(): {
  href: string;
  labelKey: TranslationKey;
  startsGroup: boolean;
}[] {
  return DOCS_PAGES.map((page, i) => ({
    href: page.href,
    labelKey: page.labelKey,
    startsGroup: page.group === "technical" && DOCS_PAGES[i - 1]?.group !== "technical",
  }));
}
