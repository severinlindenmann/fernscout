import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { clearMatterCache, isDraft } from "./entries";
// contentRoot() rather than userDir() — lib/trips.ts resolves a journal's own
// paths the same way, and it keeps a content reader out of lib/users, whose
// config loading makes it awkward to mock in tests that care about neither.
import { contentRoot } from "./contentRoot";

export type AboutPage = { markdown: string };

/**
 * `content/<user>/about.md` — who this journal is, in the author's own
 * words. B10: the only place a reader was ever told who a trip belonged to
 * was the costs page, and only when costs were visible to them.
 *
 * Read the same way `plan.md` and `costs.md` are (`fs.existsSync` +
 * `gray-matter`, malformed frontmatter logged and treated as absent rather
 * than thrown — same shape as `readPlanFile` and `readCostsFile`) because a
 * typo here must not take a reading page down.
 *
 * It obeys the same draft rule as a day (AGENTS.md): `status: draft` in the
 * frontmatter keeps it off the page. `includeDrafts` is for the owner's own
 * preview of a page they have not finished writing yet; every other caller
 * gets the published-only default.
 */
export function getAbout(
  username: string,
  options: { includeDrafts?: boolean } = {},
): AboutPage | null {
  const file = path.join(contentRoot(), username, "about.md");
  if (!fs.existsSync(file)) return null;

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(fs.readFileSync(file, "utf8"));
  } catch (err) {
    // See `clearMatterCache`'s doc comment (lib/matterCache.ts) for why this
    // call is not optional here: matter() caches a parse by raw content
    // before it parses, so a throwing call leaves a stale, non-throwing
    // result under this file's bytes for the next reader to find. B312.
    clearMatterCache();
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(`[about] ${file}: its frontmatter could not be parsed: ${why}`);
    return null;
  }

  if (isDraft(parsed.data) && !options.includeDrafts) return null;

  const markdown = parsed.content.trim();
  if (!markdown) return null;
  return { markdown };
}
