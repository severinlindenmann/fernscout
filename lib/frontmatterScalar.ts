/**
 * Editing one scalar line of a markdown file's frontmatter, and nothing else.
 *
 * Lifted out of `lib/api/tripVisibility.ts` when `lib/api/tripDetails.ts`
 * (B621) became its second caller. It is deliberately textual rather than
 * "parse the YAML, change the field, serialise it back": a round trip through
 * a YAML writer reorders keys, drops comments, requotes strings and reflows
 * blocks, so a call that changed `visibility:` would rewrite a file its author
 * hand-wrote, and the diff would be unreadable. This changes the one line it
 * was asked about and leaves the rest byte for byte.
 *
 * `lib/api/tripRates.ts` keeps a copy of its own on purpose: that one splices
 * a *block* (`rates:` with indented children) and this one refuses to, which
 * makes them two functions rather than one with a flag.
 */

const INDENTED_RE = /^\s+\S/;

/** Where `key:` starts inside the frontmatter, or -1 if absent. */
function frontmatterLineOf(lines: string[], closing: number, key: string): number {
  const pattern = new RegExp(`^${key}:(\\s|$)`);
  return lines.findIndex((line, i) => i > 0 && i < closing && pattern.test(line));
}

/**
 * Replace, insert or remove one top-level scalar line (`key: value`), never
 * an indented block.
 *
 * `newLine === null` removes the key rather than writing it, which is how a
 * stale `listed: false` is cleared once it no longer says anything the new
 * visibility does not already say on its own — and how a `tagline:` the owner
 * emptied stops being a key holding `""`.
 *
 * Returns `null` when there is no frontmatter block to edit, which the
 * callers turn into a refusal rather than writing a file that had none.
 */
export function spliceScalar(markdown: string, key: string, newLine: string | null): string | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0) return null;

  const at = frontmatterLineOf(lines, closing, key);
  if (at >= 0) {
    // Any indented lines under it belong to it — a scalar has none, but a
    // caller that passes a block key would otherwise leave its children
    // orphaned under the replacement.
    let end = at + 1;
    while (end < closing && INDENTED_RE.test(lines[end])) end++;
    lines.splice(at, end - at, ...(newLine === null ? [] : [newLine]));
  } else if (newLine !== null) {
    lines.splice(closing, 0, newLine);
  }
  return lines.join("\n");
}
