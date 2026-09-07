import "server-only";

/**
 * The one edit every trip-field door makes: replace a block of `trip.md`'s
 * frontmatter and leave every other byte alone.
 *
 * `.../rates` (B352) and `.../visibility` (B396) each carry their own copy of
 * this, and each says in a comment why it did not share — different shapes,
 * five lines, no reason to couple. `.../people`, `.../travellers` (B524) and
 * `.../tracks` (B531) made it five copies of the same twenty lines, which is
 * the point where the argument stops holding. The two older ones are left
 * where they are: they work, they are tested, and rewriting them buys
 * nothing but a diff.
 */

const INDENTED_RE = /^\s+\S/;

/** Where `key:` starts inside the frontmatter, or -1 if absent. */
function frontmatterLineOf(lines: string[], closing: number, key: string): number {
  const pattern = new RegExp(`^${key}:(\\s|$)`);
  return lines.findIndex((line, i) => i > 0 && i < closing && pattern.test(line));
}

/**
 * Replace one top-level frontmatter key and everything indented under it,
 * insert it if it is absent, or remove it when `newLines` is empty.
 *
 * Removing matters, and did not for rates: `people: []` is how an owner says
 * nobody but them was on this trip, and leaving a bare `people:` behind would
 * be a key whose value is null rather than an absent one. `tracks:` is the
 * same — every row on is written as no block at all.
 */
export function spliceBlock(markdown: string, key: string, newLines: string[]): string | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0) return null;

  const at = frontmatterLineOf(lines, closing, key);
  if (at >= 0) {
    let end = at + 1;
    while (end < closing && INDENTED_RE.test(lines[end])) end++;
    lines.splice(at, end - at, ...newLines);
  } else if (newLines.length > 0) {
    lines.splice(closing, 0, ...newLines);
  }
  return lines.join("\n");
}

