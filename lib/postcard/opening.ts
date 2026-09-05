/**
 * The day's opening, short enough for a card.
 *
 * The twin is the file on disk: frontmatter, then prose. Drop the frontmatter,
 * drop headings and image lines, and take whole sentences until there is no
 * room for another — cutting mid-word would look like a bug in the box the
 * owner is about to edit.
 *
 * It lives here rather than in `components/PostcardSheet.tsx`, where it was
 * written, because since B478 the trimming happens on the server: the sheet
 * offers every day of the trip in every language the journal keeps, and
 * fetching that many markdown twins into a browser to trim them there is a lot
 * of bytes spent on arithmetic the server had the files for. Deliberately not
 * `server-only` — the frontmatter strip is what makes it right for a raw twin
 * too, and a caller either side of the wire must get the same answer.
 */
export function openingOf(markdown: string, limit = 320): string {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const prose = body
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#") && !line.trim().startsWith("!["))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (prose.length <= limit) return prose;
  const cut = prose.slice(0, limit);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 0 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" "));
}
