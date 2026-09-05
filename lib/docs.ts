import fs from "node:fs";
import path from "node:path";

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
