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
