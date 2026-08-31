/**
 * Measuring and wrapping text for the book.
 *
 * The postcard gets away with estimating character widths by class — a card
 * holds four lines and has slack. A book does not: a paragraph that overruns
 * its column by three percent runs off the page four hundred times.
 *
 * So these are the real Adobe Core-14 advance widths for Helvetica and
 * Helvetica-Bold, in 1/1000 em, which is what the base-14 fonts in the PDF
 * actually use. Latin-1 accented letters take the width of the letter they
 * are built from, which for Helvetica is exact rather than approximate.
 */

/** ASCII 32–126, in order, for Helvetica. */
const HELVETICA: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** ASCII 32–126, in order, for Helvetica-Bold. */
const HELVETICA_BOLD: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

export type FontWeight = "regular" | "bold";

/**
 * Typographic punctuation, mapped to where WinAnsiEncoding puts it.
 *
 * WinAnsi is not Latin-1: it fills the 0x80–0x9F range, which Latin-1 leaves
 * as control codes, with exactly the marks a book needs — curly quotes, en and
 * em dashes, an ellipsis, a bullet. Folding an em dash to two hyphens, which
 * is what a naive ASCII pass does, is the quickest way to make a printed page
 * look like a text file.
 */
const WIN_ANSI: Record<string, string> = Object.fromEntries(
  (
    [
      ["€", 0x80],
      ["‚", 0x82],
      ["ƒ", 0x83],
      ["„", 0x84],
      ["…", 0x85],
      ["†", 0x86],
      ["‡", 0x87],
      ["ˆ", 0x88],
      ["‰", 0x89],
      ["Š", 0x8a],
      ["‹", 0x8b],
      ["Œ", 0x8c],
      ["Ž", 0x8e],
      ["‘", 0x91],
      ["’", 0x92],
      ["“", 0x93],
      ["”", 0x94],
      ["•", 0x95],
      ["–", 0x96],
      ["—", 0x97],
      ["˜", 0x98],
      ["™", 0x99],
      ["š", 0x9a],
      ["›", 0x9b],
      ["œ", 0x9c],
      ["ž", 0x9e],
      ["Ÿ", 0x9f],
    ] as const
  ).map(([ch, code]) => [ch, String.fromCharCode(code)]),
);

/** Helvetica advance widths for the marks outside 32–126, by code point. */
const EXTRA: Record<number, [regular: number, bold: number]> = {
  0x80: [556, 556],
  0x82: [222, 278],
  0x84: [333, 500],
  0x85: [1000, 1000],
  0x86: [556, 556],
  0x87: [556, 556],
  0x89: [1000, 1000],
  0x8b: [333, 333],
  0x8c: [1000, 1000],
  0x91: [222, 278],
  0x92: [222, 278],
  0x93: [333, 500],
  0x94: [333, 500],
  0x95: [350, 350],
  0x96: [556, 556],
  0x97: [1000, 1000],
  0x99: [1000, 1000],
  0x9b: [333, 333],
  0x9c: [944, 944],
  0xa9: [737, 737], // copyright
  0xab: [556, 556], // guillemotleft
  0xb7: [278, 278], // periodcentered
  0xbb: [556, 556], // guillemotright
  0xc6: [1000, 1000], // AE
  0xd7: [584, 584], // multiply
  0xd8: [778, 778], // Oslash
  0xdf: [556, 611], // germandbls
  0xe6: [889, 889], // ae
  0xf8: [611, 611], // oslash
};

/**
 * Strips diacritics so a character lands on a base letter we have a width for.
 * In Helvetica an accent adds no advance, so for the accented Latin letters
 * this is exact rather than approximate.
 */
function base(ch: string): string {
  const stripped = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return stripped || ch;
}

function advance(ch: string, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return table[code - 32];
  const extra = EXTRA[code];
  if (extra) return extra[bold ? 1 : 0];
  const folded = base(ch);
  if (folded !== ch) {
    let units = 0;
    for (const c of folded) units += advance(c, bold);
    return units;
  }
  return table["n".charCodeAt(0) - 32];
}

/**
 * Width of `text` at `size` points.
 *
 * Measures the *encoded* form, so the string measured here and the string the
 * PDF writer draws are the same string.
 */
export function measure(text: string, size: number, weight: FontWeight = "regular"): number {
  const bold = weight === "bold";
  let units = 0;
  for (const ch of toWinAnsi(text)) units += advance(ch, bold);
  return (units / 1000) * size;
}

/**
 * Puts a string into WinAnsiEncoding, which is what the base-14 fonts use.
 *
 * Done here rather than in the PDF writer so that measuring and drawing see
 * exactly the same characters — otherwise a line measured one way and drawn
 * another overhangs its column, and the overhang only appears on paper.
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = WIN_ANSI[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.charCodeAt(0);
    // 0x20–0x7E and 0xA0–0xFF are shared with Latin-1; 0x80–0x9F is a mark
    // this function encoded on an earlier pass.
    if ((code >= 32 && code <= 126) || (code >= 128 && code <= 255)) {
      out += ch;
      continue;
    }
    out += base(ch);
  }
  // Anything still unencodable becomes a space: a missing glyph should read as
  // a gap on the page, not as a question mark.
  return out.replace(/[^\u0020-\u007E\u0080-\u00FF]/g, " ");
}

/** Greedy line breaking. Words longer than the column are broken by character
 * rather than allowed to overhang. */
export function wrap(
  text: string,
  size: number,
  maxWidth: number,
  weight: FontWeight = "regular",
): string[] {
  const lines: string[] = [];
  for (const paragraph of toWinAnsi(text).split(/\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size, weight) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word, size, weight) <= maxWidth) {
        line = word;
        continue;
      }
      // A URL or a very long compound. Break it rather than let it bleed out.
      let chunk = "";
      for (const ch of word) {
        if (measure(chunk + ch, size, weight) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = "";
        }
        chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  // Collapse the run of empties a trailing newline leaves behind.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Markdown, reduced to what a printed page can show.
 *
 * The entries are markdown, but a photobook page is not a web page: there is
 * no link to follow and no image to lazy-load. Emphasis marks and link syntax
 * are noise on paper, so they come off, and the text that carried them stays.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .trim();
}

/** Splits prose into paragraphs, dropping the blank runs between them. */
export function paragraphsOf(markdown: string): string[] {
  return plainText(markdown)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08-14" → "14 August 2026". Parsed by hand rather than through Date so
 * the output cannot shift by a day depending on where the machine is. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "14–28 August 2026", collapsing whatever the two dates share. */
export function formatDateRange(startIso: string, endIso: string): string {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startIso);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endIso);
  const dash = "–";
  if (!a || !b) return `${startIso} ${dash} ${endIso}`;
  if (startIso === endIso) return formatDate(startIso);
  const sameYear = a[1] === b[1];
  const sameMonth = sameYear && a[2] === b[2];
  if (sameMonth) {
    return `${Number(a[3])}${dash}${Number(b[3])} ${MONTHS[Number(a[2]) - 1]} ${a[1]}`;
  }
  if (sameYear) {
    return (
      `${Number(a[3])} ${MONTHS[Number(a[2]) - 1]} ${dash} ` +
      `${Number(b[3])} ${MONTHS[Number(b[2]) - 1]} ${a[1]}`
    );
  }
  return `${formatDate(startIso)} ${dash} ${formatDate(endIso)}`;
}
