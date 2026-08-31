/**
 * The physical postcard.
 *
 * Everything here is in millimetres, converted to PDF points at the edge.
 * Print geometry is the one part of this project where a number being
 * slightly wrong is invisible on screen and obvious on paper, so the
 * measurements live in one place with their reasons attached.
 */

/** PDF user space is 1/72 inch. */
export const MM_TO_PT = 72 / 25.4;

export function mm(value: number): number {
  return value * MM_TO_PT;
}

export type PostcardSpec = {
  name: string;
  /** Finished size after cutting. */
  trimWidthMm: number;
  trimHeightMm: number;
  /** Artwork extends this far past the trim on every edge. */
  bleedMm: number;
  /** Nothing that matters goes within this of the trim. */
  safeMm: number;
  /** Target resolution for the photograph. */
  dpi: number;
};

/** A6 landscape — the standard European postcard, and what Swiss Post and
 * Stannp both print. */
export const A6_LANDSCAPE: PostcardSpec = {
  name: "A6 landscape",
  trimWidthMm: 148,
  trimHeightMm: 105,
  bleedMm: 3,
  safeMm: 5,
  dpi: 300,
};

/** Media box: trim plus bleed on all four edges. */
export function mediaBox(spec: PostcardSpec): { width: number; height: number } {
  return {
    width: mm(spec.trimWidthMm + spec.bleedMm * 2),
    height: mm(spec.trimHeightMm + spec.bleedMm * 2),
  };
}

/** How many pixels wide a full-bleed photo must be to hit the target DPI. */
export function requiredPixelWidth(spec: PostcardSpec): number {
  return Math.ceil(((spec.trimWidthMm + spec.bleedMm * 2) / 25.4) * spec.dpi);
}

export function requiredPixelHeight(spec: PostcardSpec): number {
  return Math.ceil(((spec.trimHeightMm + spec.bleedMm * 2) / 25.4) * spec.dpi);
}

/**
 * The address block, positioned to postal specification.
 *
 * This is machine-read by sorting equipment, so its position is not a design
 * decision. Measurements are from the trim edge of an A6 landscape card:
 * the address occupies the lower right, the stamp the upper right, and the
 * left half is the message.
 */
export const ADDRESS_BLOCK = {
  leftMm: 78,
  bottomMm: 12,
  widthMm: 60,
  heightMm: 40,
} as const;

export const STAMP_AREA = {
  rightMm: 6,
  topMm: 6,
  widthMm: 26,
  heightMm: 32,
} as const;

/** The divider between message and address on the back of the card. */
export const DIVIDER_X_MM = 72;
