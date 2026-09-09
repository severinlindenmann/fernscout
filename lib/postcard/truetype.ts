/**
 * Just enough TrueType to describe a face to a PDF.
 *
 * A `/FontDescriptor` has to carry the face's ascent, descent, cap height,
 * bounding box, italic angle and a stem width. Those could be typed in as
 * constants for the three faces this repository ships, and would then be
 * silently wrong the day somebody swaps a face — the sort of number that is
 * invisible on screen and obvious once a courier hands you twenty copies.
 * So they are read out of the font file.
 *
 * This reads four tables and stops: `head` for the units per em and the
 * bounding box, `hhea` for ascent and descent, `post` for the italic angle,
 * and `OS/2` for the cap height when the face is new enough to carry one.
 * It is not a font parser and must not grow into one — no glyph outlines, no
 * cmap, no subsetting. The PDF gets the whole file and a `/Widths` array from
 * `lib/photobook/text.ts`, which is what actually positions the text.
 */

export type FontMetrics = {
  unitsPerEm: number;
  /** All of these are already scaled to the 1/1000 em the PDF wants. */
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  bbox: [number, number, number, number];
};

function u16(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1];
}
function i16(b: Uint8Array, at: number): number {
  const v = u16(b, at);
  return v >= 0x8000 ? v - 0x10000 : v;
}
function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function tables(font: Uint8Array): Map<string, number> {
  const count = u16(font, 4);
  const found = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(font[at], font[at + 1], font[at + 2], font[at + 3]);
    found.set(tag, u32(font, at + 8));
  }
  return found;
}

export function readFontMetrics(font: Uint8Array): FontMetrics {
  const at = tables(font);
  const head = at.get("head");
  const hhea = at.get("hhea");
  if (head === undefined || hhea === undefined) {
    throw new Error("truetype: the font has no head or hhea table");
  }
  const unitsPerEm = u16(font, head + 18) || 1000;
  const scale = (v: number) => Math.round((v * 1000) / unitsPerEm);

  const bbox: [number, number, number, number] = [
    scale(i16(font, head + 36)),
    scale(i16(font, head + 38)),
    scale(i16(font, head + 40)),
    scale(i16(font, head + 42)),
  ];

  const ascent = scale(i16(font, hhea + 4));
  const descent = scale(i16(font, hhea + 6));

  // `post`'s italic angle is a 16.16 fixed-point number.
  const post = at.get("post");
  const italicAngle = post === undefined ? 0 : Math.round(((u32(font, post + 4) | 0) / 65536) * 100) / 100;

  // OS/2 version 2 and later carry sCapHeight; older faces do not, and the
  // ascent is the honest stand-in rather than a guess at a ratio.
  const os2 = at.get("OS/2");
  let capHeight = ascent;
  if (os2 !== undefined && u16(font, os2) >= 2) capHeight = scale(i16(font, os2 + 88));

  return { unitsPerEm, ascent, descent, capHeight, italicAngle, bbox };
}
