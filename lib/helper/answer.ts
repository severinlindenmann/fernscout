/**
 * A tiny declared vocabulary for the model's own prose — B1120.
 *
 * `lib/helper/model.ts` lets the model answer in free text, and it writes
 * markdown, because that is what it was trained to write. On the site that
 * showed up as literal asterisks around a day's own words, with nothing
 * marking where the journal's prose stopped and the agent's began — the one
 * boundary this product cares most about.
 *
 * So: four marks, declared here and nowhere else, and nothing outside them.
 * Bold names a thing in the journal, a list is two or more of a kind, a quote
 * is words that came out of the journal, and a meta line is counts or state
 * about the thing just named. `threadSystemPrompt` in `./model.ts` teaches the
 * model these four and only these four; this file turns the string it sends
 * back into something `components/AnswerText.tsx` can draw.
 *
 * **This runs strictly after the honesty net.** Every guard in `./model.ts`
 * matches on `answer` as the model wrote it — a claim is checked against the
 * turn, never against the phrasing, but the phrasing still has to be the
 * phrasing the model actually produced, or a guard tuned against one string
 * is silently checking another. So this module is never imported by
 * `./model.ts`, and parses only for drawing: the source string this returns
 * blocks for is never rewritten, normalised or handed back into the thread.
 *
 * No markdown library. Four cases, by hand, and anything outside them
 * degrades to a plain line rather than vanishing — an unclosed `**`, a
 * heading, a link, a table are all just words once this is done with them.
 */

/** One run of a line: either journal-bold or not. */
export type AnswerInline = { bold: boolean; text: string };

/** One thing the answer draws. `text` is an ordinary line (which may be
 *  empty, to keep the paragraph breaks the model wrote). */
export type AnswerBlock =
  | { kind: "text"; parts: AnswerInline[] }
  | { kind: "list"; items: AnswerInline[][] }
  | { kind: "quote"; lines: AnswerInline[][] }
  | { kind: "meta"; text: string };

const LIST_LINE = /^-\s+(.*)$/;
const QUOTE_LINE = /^>\s?(.*)$/;
const META_LINE = /^~\s?(.*)$/;
const BOLD = /\*\*(.+?)\*\*/g;

/** `**bold**` inside one line, everything else kept as plain runs. An odd
 *  `**` with nothing to close it matches nothing and is left as literal
 *  text, which is the whole of "degrades rather than vanishes". */
function inline(line: string): AnswerInline[] {
  const parts: AnswerInline[] = [];
  let last = 0;
  for (const match of line.matchAll(BOLD)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ bold: false, text: line.slice(last, start) });
    parts.push({ bold: true, text: match[1] });
    last = start + match[0].length;
  }
  if (last < line.length || parts.length === 0) parts.push({ bold: false, text: line.slice(last) });
  return parts;
}

/**
 * The answer, as the four blocks a person reads instead of raw markdown.
 *
 * A single `- ` line is not a list — the vocabulary says two items or more —
 * so it falls through and reads as an ordinary line, dash and all: still
 * words, never punctuation soup.
 */
export function parseAnswer(text: string): AnswerBlock[] {
  const lines = text.split("\n");
  const blocks: AnswerBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const meta = META_LINE.exec(lines[i]);
    if (meta) {
      blocks.push({ kind: "meta", text: meta[1] });
      i += 1;
      continue;
    }

    if (QUOTE_LINE.test(lines[i])) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_LINE.test(lines[i])) {
        quoted.push(QUOTE_LINE.exec(lines[i])![1]);
        i += 1;
      }
      blocks.push({ kind: "quote", lines: quoted.map(inline) });
      continue;
    }

    if (LIST_LINE.test(lines[i])) {
      let j = i;
      const items: string[] = [];
      while (j < lines.length && LIST_LINE.test(lines[j])) {
        items.push(LIST_LINE.exec(lines[j])![1]);
        j += 1;
      }
      if (items.length >= 2) {
        blocks.push({ kind: "list", items: items.map(inline) });
        i = j;
        continue;
      }
      // One dash, not a list — read on as a plain line below.
    }

    blocks.push({ kind: "text", parts: inline(lines[i]) });
    i += 1;
  }
  return blocks;
}
