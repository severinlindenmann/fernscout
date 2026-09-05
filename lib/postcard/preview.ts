import {
  ADDRESS_BLOCK,
  ADDRESS_LEADING_PT,
  ADDRESS_PT,
  A6_LANDSCAPE,
  DIVIDER_X_MM,
  LEADING,
  MESSAGE_PT,
  SIGNATURE_PT,
  STAMP_AREA,
  fontFraction,
  type PostcardSpec,
} from "./spec.ts";

/**
 * The card on screen, from the same millimetres the printer gets — B434.
 *
 * Not a second layout engine, for the reason `lib/photobook/preview.ts` gives
 * about its own: two of them drift, and the one that drifts is always the one
 * nobody printed. Every rectangle here is the same constant
 * `lib/postcard/render.ts` draws from, expressed as a percentage of the bleed
 * box instead of in points — so if the address block is in the wrong place on
 * this page it is in the wrong place on the paper, which is very much cheaper
 * to notice here.
 *
 * What it is *not* is a pixel-exact proof. The typeface is the browser's, the
 * message wraps by the browser's rules rather than by `render.ts`'s width
 * table, and nothing here knows about ink. It answers "is this the right
 * photograph, to the right people, with the right words on it", which is the
 * question somebody is actually asking before they spend fifteen credits a
 * card. The PDF is linked from the page for anyone who wants the real bytes.
 *
 * The y axis is flipped: PDF space counts up from the bottom, CSS counts down
 * from the top.
 */

export type Box = { left: string; top: string; width: string; height: string };

function boxes(spec: PostcardSpec) {
  const w = spec.trimWidthMm + spec.bleedMm * 2;
  const h = spec.trimHeightMm + spec.bleedMm * 2;
  const pct = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;

  /** A rectangle given in trim-relative mm from the bottom left. */
  const at = (xMm: number, yMm: number, wMm: number, hMm: number): Box => ({
    left: pct((xMm + spec.bleedMm) / w),
    top: pct((h - (yMm + spec.bleedMm) - hMm) / h),
    width: pct(wMm / w),
    height: pct(hMm / h),
  });

  return { w, h, at, pct };
}

/** Where everything on the back of the card sits, as CSS percentages. */
export function backLayout(spec: PostcardSpec = A6_LANDSCAPE) {
  const { w, h, at, pct } = boxes(spec);
  return {
    /** The whole card including bleed, as an aspect ratio for the container. */
    aspect: `${w} / ${h}`,
    /** The finished edge — what survives the guillotine. */
    trim: at(0, 0, spec.trimWidthMm, spec.trimHeightMm),
    /** Message territory: everything left of the divider, inside the safe area. */
    message: at(
      spec.safeMm,
      spec.safeMm,
      DIVIDER_X_MM - spec.safeMm * 2,
      spec.trimHeightMm - spec.safeMm * 2,
    ),
    /** The rule between message and address. */
    dividerLeft: pct((DIVIDER_X_MM + spec.bleedMm) / w),
    /** Where the sorting machine reads. Its position is postal specification
     * rather than taste — see `spec.ts`. */
    address: at(
      ADDRESS_BLOCK.leftMm,
      ADDRESS_BLOCK.bottomMm,
      ADDRESS_BLOCK.widthMm,
      ADDRESS_BLOCK.heightMm,
    ),
    stamp: at(
      spec.trimWidthMm - STAMP_AREA.rightMm - STAMP_AREA.widthMm,
      spec.trimHeightMm - STAMP_AREA.topMm - STAMP_AREA.heightMm,
      STAMP_AREA.widthMm,
      STAMP_AREA.heightMm,
    ),
    /**
     * Type sizes as `cqw` — percentages of the *card's* width.
     *
     * Derived, never written down. B451: the page carried a hand-typed
     * `2.4cqw`, which was close to right and applied against the wrong
     * container-query container — `containerType` was on the paragraph, so the
     * message sized itself against its own 46%-wide column and came out at
     * roughly twice the size, five words to a card.
     *
     * The container is the card element; these are meaningless anywhere else.
     */
    font: {
      message: `${(fontFraction(MESSAGE_PT, spec) * 100).toFixed(3)}cqw`,
      signature: `${(fontFraction(SIGNATURE_PT, spec) * 100).toFixed(3)}cqw`,
      address: `${(fontFraction(ADDRESS_PT, spec) * 100).toFixed(3)}cqw`,
      /** Unitless, so it multiplies whatever font size it lands on. */
      leading: LEADING,
      addressLeading: ADDRESS_LEADING_PT / ADDRESS_PT,
    },
  };
}

/**
 * Is this photograph big enough to print?
 *
 * A6 with bleed at 300 dpi wants 1819 × 1312. Ingest writes derivatives at
 * 2000 px on the *longest* edge, so a landscape photograph clears this and a
 * **portrait one cannot** — its long edge is the 1312, leaving about 1333 ×
 * 2000 and a short edge nowhere near 1819. That is not a rare case; it is
 * every phone photograph held upright.
 *
 * Which is why the preview says so rather than the renderer muttering it into
 * a warnings array nobody reads: the person is about to buy paper.
 */
export function resolutionNote(
  width: number,
  height: number,
  spec: PostcardSpec = A6_LANDSCAPE,
): { ok: boolean; dpi: number } {
  const needW = ((spec.trimWidthMm + spec.bleedMm * 2) / 25.4) * spec.dpi;
  const needH = ((spec.trimHeightMm + spec.bleedMm * 2) / 25.4) * spec.dpi;
  // Cover, not fit: the photo is scaled up until it fills both dimensions, so
  // the binding constraint is whichever axis has to stretch furthest.
  const scale = Math.max(needW / width, needH / height);
  return { ok: scale <= 1, dpi: Math.round(spec.dpi / Math.max(scale, 1e-9)) };
}
