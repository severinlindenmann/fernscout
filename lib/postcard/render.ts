import {
  A6_LANDSCAPE,
  ADDRESS_BLOCK,
  ADDRESS_LEADING_PT,
  ADDRESS_PT,
  DIVIDER_X_MM,
  FIGURES_AREA,
  LEADING,
  MAX_CROP_ZOOM,
  MESSAGE_PT,
  SIGNATURE_PT,
  STAMP_AREA,
  mm,
  mediaBox,
  requiredPixelWidth,
  type PostcardSpec,
} from "./spec.ts";
import { PdfBuilder, readJpeg, type JpegImage, type Page } from "./pdf.ts";
import type { Crop } from "./orders.ts";
// The same PDF figures the photobook draws — B628. Not a second set: this
// module already writes through `lib/postcard/pdf.ts`'s own `PdfBuilder`,
// which is exactly what `drawTravellers` was written against.
import { drawTravellers } from "../photobook/travellers.ts";
import type { Figure } from "../travellers/vocabulary.ts";

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
  /**
   * Where the front photograph is cropped from — B627. Absent means centre,
   * which is what every postcard printed before this existed. Never scales
   * the photograph anisotropically: this only moves the same cover-crop
   * rectangle `coverRect` always drew.
   */
  crop?: Crop;
  /** Draws trim and safe-area guides. For proofing only — never for printing. */
  guides?: boolean;
  /**
   * The party to draw beside the signature — B628. Absent or empty draws
   * nothing: the back is exactly as it was before this existed, which is the
   * off-by-default the option promises. The caller resolves who this is —
   * ordinarily a trip's own `travellers:` block, the same one the photobook
   * and the site's hero already draw — this module only paints it.
   */
  figures?: Figure[];
  /**
   * Who prints the address block and the stamp box — B982.
   *
   * `"draw"`, the default, is the card as this module has always drawn it:
   * the recipient in the lower right where a sorting machine reads, and an
   * empty rectangle up in the corner where a stamp goes. It is what the
   * owner's own proof copy and the receipt attachment want.
   *
   * `"printer"` leaves both empty, and is what actually goes to a provider
   * that addresses the card itself. Stannp does: the recipient travels as
   * `recipient[...]` fields (see `buildStannpRequest`) and their press lays
   * the address and the postal indicia over the back it is given. Sending a
   * back with ours already on it printed the two on top of each other —
   * two names, two streets, one unreadable card, and the proof of it is the
   * screenshot on B982.
   *
   * It is a caller's choice rather than something read from the config here,
   * because this module renders and knows nothing about providers;
   * `lib/postcard/send.ts` is where the two copies are made and is the one
   * place that knows which is which.
   */
  address?: "draw" | "printer";
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

/**
 * How much of the message the printer will actually set — B1511.
 *
 * The preview cannot answer this. On a phone the card renders about 358px
 * wide, where the message's true size is 8.5px, so `MESSAGE_FLOOR_PX` takes
 * over at 14 and the words come out two thirds larger than they print
 * (B1286, and the caption says so). That is the right trade — 8px is not
 * readable — but it leaves somebody looking at a card that seems full when it
 * is not, and cutting a sentence they did not need to cut.
 *
 * So the question is answered from the printer's own arithmetic instead: the
 * same wrap, the same box, the same leading the PDF uses a hundred lines
 * below. Exported for the preview page, which has no other way to know.
 */
export function messageFit(
  message: string,
  spec: PostcardSpec = A6_LANDSCAPE,
): { lines: number; maxLines: number } {
  const bleed = mm(spec.bleedMm);
  const messageWidth = mm(DIVIDER_X_MM - spec.safeMm - 8);
  const messageTop = bleed + mm(spec.trimHeightMm - spec.safeMm - 8);
  const leading = MESSAGE_PT * LEADING;
  return {
    lines: wrap(message, MESSAGE_PT, messageWidth).length,
    maxLines: Math.floor((messageTop - bleed - mm(spec.safeMm + 10)) / leading),
  };
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

/** The centre — every postcard's crop before B627, and still the default for
 * one nobody has dragged. */
const CENTRE: Crop = { x: 0.5, y: 0.5 };

/**
 * Scales a photograph to cover the card, cropping the overflow.
 *
 * Cover rather than fit: a postcard with white bars down the side is not a
 * postcard. The caller is told the effective DPI so a photo too small to print
 * well is a warning rather than a surprise.
 *
 * `crop` says which part of the overflow survives, in the same terms the
 * preview page's drag control writes: `x` a fraction across the photograph,
 * `y` a fraction down it, ordinary image-space with a top-left origin. PDF
 * space is **y-upwards**, so the two axes are not symmetric here — `x` scales
 * the offset directly, `y` scales it from the far side, `(1 - crop.y)`, so
 * that `y: 0` still means "keep the top" rather than "keep the bottom". This
 * is exactly `lib/photobook/plan.ts`'s `cover()`, B513's answer to the same
 * problem, reused rather than reinvented. At `CENTRE` this is the old
 * centring formula.
 */
const zoomOf = (crop?: Crop) => Math.min(MAX_CROP_ZOOM, Math.max(1, crop?.zoom ?? 1));

function coverRect(image: JpegImage, boxWidth: number, boxHeight: number, crop: Crop = CENTRE) {
  // Both axes by the same factor, always: `zoom` multiplies the cover scale
  // rather than one side of it, so a crop can go closer in but never come
  // out anisotropic. The anchor arithmetic below is untouched by it — the
  // point of the photograph at (`crop.x`, `crop.y`) lands at that same
  // fraction across the card whatever the zoom, which is exactly what CSS
  // `transform-origin` does in the preview, so the two agree by construction.
  const scale = Math.max(boxWidth / image.width, boxHeight / image.height) * zoomOf(crop);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (boxWidth - width) * crop.x,
    y: (boxHeight - height) * (1 - crop.y),
    width,
    height,
  };
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
  // The pixels actually printed, not the pixels in the file: zooming in puts
  // fewer of them across the same card, and a warning computed from the whole
  // photograph would report the resolution of a picture nobody ordered.
  const usedWidth = Math.round(image.width / zoomOf(input.crop));
  const effectiveDpi = Math.floor((usedWidth / (spec.trimWidthMm + spec.bleedMm * 2)) * 25.4);
  if (usedWidth < needed) {
    warnings.push({
      code: "low-resolution",
      detail:
        `Photo is ${usedWidth}px wide; ${needed}px is needed for ${spec.dpi} DPI ` +
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
    const cover = coverRect(image, box.width, box.height, input.crop);
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

  // Both of these belong to whoever addresses the card — B982. The empty
  // stamp rectangle is drawn beside the address rather than separately from
  // it for that reason: a printer that lays down its own indicia lays it
  // exactly here, and a hairline box under it is the same overprint the
  // address was.
  const addressed = (input.address ?? "draw") === "draw";

  const stampX = bleed + mm(spec.trimWidthMm - STAMP_AREA.rightMm - STAMP_AREA.widthMm);
  const stampY = bleed + mm(spec.trimHeightMm - STAMP_AREA.topMm - STAMP_AREA.heightMm);
  const stampBox = addressed ? [
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
  ] : [];
  for (const [x1, y1, x2, y2] of stampBox) {
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

  // The traveller figures, beside the signature — B628. Anchored to the
  // divider, at the same baseline the signature sits on, and sized so the
  // whole box stays inside the safe area on every edge. `drawTravellers`
  // fits whatever it is given into the box without exceeding it, so once the
  // box itself is inside the safe rectangle the figures are too.
  if (input.figures && input.figures.length > 0) {
    const figuresWidth = mm(FIGURES_AREA.widthMm);
    const figuresRight = bleed + mm(DIVIDER_X_MM - FIGURES_AREA.gapFromDividerMm);
    const figuresLeft = figuresRight - figuresWidth;
    const safeLeft = bleed + mm(spec.safeMm);
    if (figuresLeft >= safeLeft) {
      drawTravellers(
        back,
        (x, y) => [x, y],
        {
          x: figuresLeft,
          y: bleed + mm(spec.safeMm + 1),
          width: figuresWidth,
          height: mm(FIGURES_AREA.heightMm),
        },
        input.figures,
      );
    }
  }

  const addressLeft = bleed + mm(ADDRESS_BLOCK.leftMm);
  const addressTop = bleed + mm(ADDRESS_BLOCK.bottomMm + ADDRESS_BLOCK.heightMm);
  const addressLines = [
    input.to.name,
    input.to.line1,
    input.to.line2,
    `${input.to.postcode} ${input.to.city}`.trim(),
    input.to.country,
  ].filter((l): l is string => Boolean(l && l.trim()));

  if (addressed) {
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
  }

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
