import fs from "node:fs";
import path from "node:path";

/**
 * The `/docs` page's whole content strategy: read it off the files that are
 * already true, rather than write a second copy that drifts from them. B23
 * is the same argument made about `docs/` itself — a reference kept in two
 * places disagrees with itself within a month — so this reads `README.md`
 * and `docs/ingest.md` at request time instead of retyping their prose here.
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
 * Pushes every markdown heading in a block down `levels` levels (default 1).
 *
 * `docs/ingest.md` is a standalone file with its own `#`/`##` structure; the
 * `/docs` page embeds it wholesale under a `###` heading of its own, so its
 * headings have to become `####`/`#####` or the two collide at the same
 * visual size and the page reads as flat where it is not.
 */
export function demote(markdown: string, levels = 1): string {
  return markdown.replace(/^(#{1,6})(\s)/gm, (_m, hashes: string, space: string) =>
    "#".repeat(Math.min(6, hashes.length + levels)) + space,
  );
}

/** Drops a markdown file's own `# Title` line (and the blank line after it),
 * for when the embedding page already supplies a heading for the section. */
export function dropTitle(markdown: string): string {
  return markdown.replace(/^#\s+.*\n+/, "");
}
