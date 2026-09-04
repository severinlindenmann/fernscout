// Quoting the values that have to live on one line of a YAML frontmatter block.
//
// Pure, like the rest of lib/validate: no fs, no "server-only". The trip
// writer and the day writer both call it, which is the point — they used to
// carry a private copy of the same two-character escape each (`q()` in
// lib/tripWrite.ts, `quote()` in lib/api/entries.ts) and both copies were
// wrong in the same way.
//
// B204 is what that cost. Neither escaped a newline, so a caller-supplied
// title containing a line break closed the frontmatter block from inside the
// value:
//
//     title: "B83 QA broken trip
//     ---
//
// The trip did not parse, was therefore invisible at every reading path, and
// could not be deleted — every delete path resolves the trip first and this
// one does not resolve. One POST to a documented endpoint permanently consumed
// a trip id, recoverable only with a shell on the server.
//
// Two defences, and deliberately both rather than either alone:
//
//   - `singleLineProblem` refuses a multi-line title at the door, so the
//     caller is told which field is wrong instead of being told "this is a
//     bug; please report it".
//   - `quoteScalar` cannot emit invalid YAML whatever it is handed, so the
//     next writer that forgets to validate still produces a file that reads
//     back.

/**
 * Control characters with no escape of their own in YAML's double-quoted
 * style. `\n`, `\r` and `\t` are handled by name below; the rest become
 * `\uXXXX`, which js-yaml — and therefore gray-matter — reads back exactly.
 */
const OTHER_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** YAML-quote a value that goes on one line, and only ever one line. */
export function quoteScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(OTHER_CONTROL, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"${escaped}"`;
}

/**
 * A sentence naming the problem, or null when the value is fine.
 *
 * Refused rather than silently folded onto one line: a title is somebody's
 * words and a writer does not get to edit them, and a caller that sent two
 * lines by accident wants to hear about it now rather than find a title with
 * a stray escape in it on the site.
 */
export function singleLineProblem(field: string, value: string): string | null {
  if (!/[\r\n]/.test(value)) return null;
  return (
    `${field} must be a single line — it is written as one line of the file's frontmatter, ` +
    `and a line break inside it would end the block early. Put the longer version in the prose.`
  );
}
