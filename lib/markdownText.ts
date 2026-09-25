/**
 * A rough markdown → plain text pass. Not a renderer — entries are rendered
 * properly (`react-markdown` + `remark-gfm`) on the page itself; this exists
 * for surfaces that need indexable or syndicatable plain text instead of
 * markup: the RSS `<description>` (lib/feed.ts) and the search index
 * (lib/search.ts). No filesystem access, no "server-only" — safe to import
 * from either side.
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
