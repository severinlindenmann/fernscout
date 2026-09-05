import {
  A6_LANDSCAPE,
  ADDRESS_BLOCK,
  ADDRESS_LEADING_PT,
  ADDRESS_PT,
  DIVIDER_X_MM,
  LEADING,
  MESSAGE_PT,
  SIGNATURE_PT,
  STAMP_AREA,
  mm,
  mediaBox,
  requiredPixelWidth,
  type PostcardSpec,
} from "./spec.ts";
import { PdfBuilder, readJpeg, type JpegImage, type Page } from "./pdf.ts";

/**
 * Composes a postcard: photograph on the front, message and address on the
 * back.
 *
 * The layout is not a design decision so much as a postal one. The back of a
 * card is divided down the middle: message on the left, address on the lower
 * right where sorting machines expect it, stamp in the upper right. Getting
 * that wrong does not look wrong — it just gets the card delivered late, or
 * not at all.
 */

export type PostalAddress = {
  name: string;
  line1: string;
  line2?: string;
  postcode: string;
  city: string;
  country?: string;
};

export type PostcardInput = {
  photo: Uint8Array;
  message: string;
  from: string;
  to: PostalAddress;
  spec?: PostcardSpec;
  /** Draws trim and safe-area guides. For proofing only — never for printing. */
  guides?: boolean;
  /**
   * Which sides to emit. Providers differ: some take one two-page PDF, and
   * Stannp takes the front and the back as separate files. Rendering one side
   * is also how a proof of the back gets inspected on its own.
   */
  sides?: "both" | "front" | "back";
};

export type PostcardWarning = {
  code: "low-resolution" | "message-truncated" | "cmyk-photo";
  detail: string;
};

export type RenderedPostcard = {
  pdf: Uint8Array;
  warnings: PostcardWarning[];
  photo: { width: number; height: number; effectiveDpi: number };
};

/**
 * Helvetica advance widths, in 1/1000 em, for the characters a postcard
 * message actually uses.
 *
 * Wrapping needs to know how wide a line is. Embedding the full AFM table for
 * one font would be silly; measuring by character class is within a few
 * percent, and the layout leaves more slack than that.
 */
function textWidth(text: string, size: number): number {
  let units = 0;
  for (const ch of text) {
    if (ch === " ") units += 278;
    else if (/[ijltfIJ.,;:'`|!]/.test(ch)) units += 278;
    else if (/[A-HK-Z0-9]/.test(ch)) units += 667;
    else if (/[mwMW]/.test(ch)) units += 889;
    else units += 556;
  }
  return (units / 1000) * size;
}

function wrap(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Scales a photograph to cover the card, cropping the overflow.
 *
 * Cover rather than fit: a postcard with white bars down the side is not a
 * postcard. The caller is told the effective DPI so a photo too small to print
 * well is a warning rather than a surprise.
 */
function coverRect(image: JpegImage, boxWidth: number, boxHeight: number) {
  const scale = Math.max(boxWidth / image.width, boxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

export function renderPostcard(input: PostcardInput): RenderedPostcard {
  const spec = input.spec ?? A6_LANDSCAPE;
  const box = mediaBox(spec);
  const bleed = mm(spec.bleedMm);
  const trim = {
    x: bleed,
    y: bleed,
    width: mm(spec.trimWidthMm),
    height: mm(spec.trimHeightMm),
  };
  const warnings: PostcardWarning[] = [];

  const image = readJpeg(input.photo);
  if (image.components === 4) {
    warnings.push({
      code: "cmyk-photo",
      detail: "The photograph is already CMYK; it is embedded unchanged.",
    });
  }

  const needed = requiredPixelWidth(spec);
  const effectiveDpi = Math.floor((image.width / (spec.trimWidthMm + spec.bleedMm * 2)) * 25.4);
  if (image.width < needed) {
    warnings.push({
      code: "low-resolution",
      detail:
        `Photo is ${image.width}px wide; ${needed}px is needed for ${spec.dpi} DPI ` +
        `at this size (this one prints at about ${effectiveDpi} DPI).`,
    });
  }

  const builder = new PdfBuilder();
  const sides = input.sides ?? "both";
  const pages: Page[] = [];

  // ---- front: photograph, full bleed ------------------------------------
  if (sides !== "back") {
    const front = builder.addPage(box.width, box.height, trim);
    pages.push(front);
    const cover = coverRect(image, box.width, box.height);
    PdfBuilder.drawImage(front, image, cover.x, cover.y, cover.width, cover.height);
  }

  if (sides === "front") {
    return {
      pdf: builder.build(),
      warnings,
      photo: { width: image.width, height: image.height, effectiveDpi },
    };
  }

  // ---- back: message, divider, stamp box, address ------------------------
  const back = builder.addPage(box.width, box.height, trim);
  pages.push(back);
  PdfBuilder.drawRect(back, 0, 0, box.width, box.height, { r: 1, g: 1, b: 1 });

  const ink = { r: 0.11, g: 0.16, b: 0.25 };
  const faint = { r: 0.75, g: 0.78, b: 0.82 };

  PdfBuilder.drawLine(
    back,
    bleed + mm(DIVIDER_X_MM),
    bleed + mm(spec.safeMm),
    bleed + mm(DIVIDER_X_MM),
    bleed + mm(spec.trimHeightMm - spec.safeMm),
    0.5,
    faint,
  );

  const stampX = bleed + mm(spec.trimWidthMm - STAMP_AREA.rightMm - STAMP_AREA.widthMm);
  const stampY = bleed + mm(spec.trimHeightMm - STAMP_AREA.topMm - STAMP_AREA.heightMm);
  for (const [x1, y1, x2, y2] of [
    [stampX, stampY, stampX + mm(STAMP_AREA.widthMm), stampY],
    [stampX, stampY, stampX, stampY + mm(STAMP_AREA.heightMm)],
    [
      stampX + mm(STAMP_AREA.widthMm),
      stampY,
      stampX + mm(STAMP_AREA.widthMm),
      stampY + mm(STAMP_AREA.heightMm),
    ],
    [
      stampX,
      stampY + mm(STAMP_AREA.heightMm),
      stampX + mm(STAMP_AREA.widthMm),
      stampY + mm(STAMP_AREA.heightMm),
    ],
  ]) {
    PdfBuilder.drawLine(back, x1, y1, x2, y2, 0.4, faint);
  }

  const messageSize = MESSAGE_PT;
  const leading = messageSize * LEADING;
  const messageLeft = bleed + mm(spec.safeMm + 3);
  const messageWidth = mm(DIVIDER_X_MM - spec.safeMm - 8);
  const messageTop = bleed + mm(spec.trimHeightMm - spec.safeMm - 8);

  const lines = wrap(input.message, messageSize, messageWidth);
  const maxLines = Math.floor((messageTop - bleed - mm(spec.safeMm + 10)) / leading);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    warnings.push({
      code: "message-truncated",
      detail: `Message is ${lines.length} lines; ${maxLines} fit on the card.`,
    });
  }
  shown.forEach((line, i) => {
    PdfBuilder.drawText(back, line, messageLeft, messageTop - i * leading, messageSize, ink);
  });

  PdfBuilder.drawText(
    back,
    input.from,
    messageLeft,
    bleed + mm(spec.safeMm + 1),
    SIGNATURE_PT,
    { r: 0.45, g: 0.5, b: 0.55 },
  );

  const addressLeft = bleed + mm(ADDRESS_BLOCK.leftMm);
  const addressTop = bleed + mm(ADDRESS_BLOCK.bottomMm + ADDRESS_BLOCK.heightMm);
  const addressLines = [
    input.to.name,
    input.to.line1,
    input.to.line2,
    `${input.to.postcode} ${input.to.city}`.trim(),
    input.to.country,
  ].filter((l): l is string => Boolean(l && l.trim()));

  addressLines.forEach((line, i) => {
    PdfBuilder.drawText(
      back,
      line,
      addressLeft,
      addressTop - i * ADDRESS_LEADING_PT,
      ADDRESS_PT,
      ink,
      i === 0 ? "F2" : "F1",
    );
  });

  if (input.guides) {
    const guide = { r: 0.9, g: 0.3, b: 0.3 };
    for (const page of pages) {
      PdfBuilder.drawLine(page, trim.x, trim.y, trim.x + trim.width, trim.y, 0.3, guide);
      PdfBuilder.drawLine(
        page,
        trim.x,
        trim.y + trim.height,
        trim.x + trim.width,
        trim.y + trim.height,
        0.3,
        guide,
      );
      PdfBuilder.drawLine(page, trim.x, trim.y, trim.x, trim.y + trim.height, 0.3, guide);
      PdfBuilder.drawLine(
        page,
        trim.x + trim.width,
        trim.y,
        trim.x + trim.width,
        trim.y + trim.height,
        0.3,
        guide,
      );
    }
  }

  return {
    pdf: builder.build(),
    warnings,
    photo: { width: image.width, height: image.height, effectiveDpi },
  };
}
