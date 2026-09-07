/**
 * The physical book.
 *
 * Same discipline as the postcard (lib/postcard/spec.ts): every measurement is
 * in millimetres, in one place, with the reason attached. Print geometry is
 * where a number being slightly wrong is invisible on screen and obvious once
 * a courier hands you twenty copies.
 *
 * A book adds three things a postcard does not have:
 *
 *  - **A gutter.** The inner margin — the one at the spine — has to be wider
 *    than the outer, because a perfect-bound book does not open flat and the
 *    first few millimetres next to the spine curve away from the reader.
 *  - **Handedness.** Page one is a right-hand page. Which side the gutter is
 *    on alternates from there, so a layout has to know whether it is on a
 *    verso (left) or a recto (right).
 *  - **Page-count rules.** Printers bind in signatures. "Any number of pages"
 *    is never true: there is a minimum, a maximum and a multiple.
 */

import { mm } from "../postcard/spec.ts";

export { mm };

/** A finished book size. Every one of these is a product Gelato prints, and
 * `productUid` is copied from its catalogue rather than constructed — the uid
 * that used to be built by concatenation was never a real product. */
export type BookSize = {
  id: string;
  name: string;
  trimWidthMm: number;
  trimHeightMm: number;
  /** Verbatim from `POST /v3/catalogs/{catalog}/products:search`. */
  productUid: string;
  cover: "soft" | "hard";
};

export const BOOK_SIZES: Record<string, BookSize> = {
  /** 20 x 20 cm. The photobook shape: neither photo orientation is a
   * second-class citizen. 210 x 210 is what this used to say and is a size
   * Gelato does not print. */
  square: {
    id: "square",
    name: "Square 200 × 200 mm",
    trimWidthMm: 200,
    trimHeightMm: 200,
    productUid:
      "photobooks-softcover_pf_200x200-mm-8x8-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_250-gsm-100-lb-cover-coated-silk_ver",
    cover: "soft",
  },
  /** Portrait, and the cheapest per page for a text-heavy trip. Not A4:
   * Gelato's nearest is 210 x 280. */
  portrait: {
    id: "portrait",
    name: "Portrait 210 × 280 mm",
    trimWidthMm: 210,
    trimHeightMm: 280,
    productUid:
      "photobooks-softcover_pf_210x280-mm-8x11-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_250-gsm-100-lb-cover-coated-silk_ver",
    cover: "soft",
  },
  /** The big one, and the only hardcover. Task 6 is what makes its cover
   * printable; until then it is refused rather than rendered wrongly. */
  "large-square": {
    id: "large-square",
    name: "Large square 280 × 280 mm",
    trimWidthMm: 280,
    trimHeightMm: 280,
    productUid:
      "photobooks-hardcover_pf_280x280-mm-11x11-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_130-gsm-65-lb-cover-coated-silk_ver",
    cover: "hard",
  },
};

export type PageCountRule = {
  min: number;
  max: number;
  /** Pages per signature. */
  multipleOf: number;
};

/**
 * The page-count rule, and there is only one.
 *
 * Read from the live API on 2026-09-07: every photobook product, soft and
 * hard, square and portrait, answers with the same list. What stood here
 * before was four providers' published ranges intersected into `multipleOf: 4`,
 * every row of it carrying `verified: false` because none had ever met an
 * account. They were wrong in both directions — 4 is stricter than any binder
 * needs, and 160 is below the 200 Gelato allows.
 */
export const GELATO_PAGE_RULE: PageCountRule = { min: 28, max: 200, multipleOf: 2 };

export type BookSpec = {
  size: BookSize;
  /** Artwork extends this far past the trim on all four edges. */
  bleedMm: number;
  /** Outer margin: nothing that matters goes within this of the trim. */
  safeMm: number;
  /** Inner margin, at the spine. Wider than `safeMm` — see the note above. */
  gutterMm: number;
  /** Target resolution for photographs. */
  dpi: number;
  /** Caliper of one leaf of the interior stock, for the spine width.
   * 0.115 mm is about 130 gsm silk, the usual photobook interior. */
  paperCaliperMm: number;
  /** Board and wrap that a hardcover case adds to the spine. 0 for softcover. */
  coverBoardMm: number;
  /** How far the cover artwork wraps around the boards. */
  coverWrapMm: number;
  pageCount: PageCountRule;
};

export function defaultSpec(size: BookSize = BOOK_SIZES["square"]): BookSpec {
  return {
    size,
    bleedMm: 3,
    safeMm: 10,
    gutterMm: 16,
    dpi: 300,
    paperCaliperMm: 0.115,
    // A hardcover case adds board to the spine; Task 6 sets this from `size.cover`.
    coverBoardMm: 0,
    coverWrapMm: 15,
    pageCount: GELATO_PAGE_RULE,
  };
}

/** Round a page count up to something a binder will accept. */
export function normalisePageCount(pages: number, rule: PageCountRule): number {
  const atLeast = Math.max(pages, rule.min);
  return Math.ceil(atLeast / rule.multipleOf) * rule.multipleOf;
}

export function fitsRule(pages: number, rule: PageCountRule): boolean {
  return pages >= rule.min && pages <= rule.max && pages % rule.multipleOf === 0;
}

/** Media box of an interior page: trim plus bleed on all four edges. */
export function pageMediaBoxMm(spec: BookSpec): { width: number; height: number } {
  return {
    width: spec.size.trimWidthMm + spec.bleedMm * 2,
    height: spec.size.trimHeightMm + spec.bleedMm * 2,
  };
}

/** Which hand a page falls on. Page 1 is always a recto. */
export type PageSide = "left" | "right";

export function sideOf(pageNumber: number): PageSide {
  return pageNumber % 2 === 1 ? "right" : "left";
}

/** A rectangle in millimetres, measured from the **trim** corner, y upwards. */
export type RectMm = { x: number; y: number; width: number; height: number };

/**
 * The area a layout may use: inside the safe margin on three edges and inside
 * the gutter on the spine edge.
 */
export function contentBoxMm(spec: BookSpec, side: PageSide): RectMm {
  const inner = spec.gutterMm;
  const outer = spec.safeMm;
  return {
    x: side === "right" ? inner : outer,
    y: spec.safeMm,
    width: spec.size.trimWidthMm - inner - outer,
    height: spec.size.trimHeightMm - spec.safeMm * 2,
  };
}

/** The full page including bleed, in trim-relative coordinates. */
export function bleedBoxMm(spec: BookSpec): RectMm {
  return {
    x: -spec.bleedMm,
    y: -spec.bleedMm,
    width: spec.size.trimWidthMm + spec.bleedMm * 2,
    height: spec.size.trimHeightMm + spec.bleedMm * 2,
  };
}

/**
 * Spine width for a given interior page count.
 *
 * Pages, not leaves: two printed pages share one sheet of paper. Getting this
 * wrong does not fail preflight — it produces a cover whose front image creeps
 * around onto the spine, which is only visible on the finished object.
 */
export function spineWidthMm(interiorPages: number, spec: BookSpec): number {
  return (interiorPages / 2) * spec.paperCaliperMm + spec.coverBoardMm;
}

/**
 * Below this, a photograph may not be handed a full page — full-bleed,
 * panorama or feature — however well its shape would otherwise fit one:
 * B502.
 *
 * `dpi` above (300) is the print target; this is the floor a photo must
 * clear before the planner will *choose* to run it that large at all. 200 is
 * a defensible number for a full page — soft enough that a printer's own
 * guidance calls it acceptable, nothing like the target. Below it a
 * photograph goes to a grid slot instead, where the same pixels reach
 * further. `checkResolution` in `plan.ts` still warns whenever a photo is
 * soft in the slot it actually got — this constant only decides which slots
 * it is offered. Tunable independently of the print target above.
 */
export const HERO_FLOOR_DPI = 200;

/** How many pixels wide a photo must be to hit the target DPI at a given
 * printed width. */
export function requiredPixels(widthMm: number, dpi: number): number {
  return Math.ceil((widthMm / 25.4) * dpi);
}

/** The DPI a photo of `pixels` px actually prints at across `widthMm`. */
export function effectiveDpi(pixels: number, widthMm: number): number {
  return widthMm > 0 ? Math.floor((pixels / widthMm) * 25.4) : 0;
}
