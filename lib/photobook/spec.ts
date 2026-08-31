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

import { MM_TO_PT, mm } from "../postcard/spec.ts";

export { MM_TO_PT, mm };

/** A finished book size. Only sizes all four candidate providers offer. */
export type BookSize = {
  id: string;
  name: string;
  trimWidthMm: number;
  trimHeightMm: number;
};

export const BOOK_SIZES: Record<string, BookSize> = {
  /** 21 × 21 cm. The photobook shape: neither photo orientation is a
   * second-class citizen, and every provider below lists it. */
  "square-210": { id: "square-210", name: "Square 210 × 210 mm", trimWidthMm: 210, trimHeightMm: 210 },
  /** A4 landscape — the widest page for panoramas, and the most paper. */
  "landscape-a4": { id: "landscape-a4", name: "A4 landscape 297 × 210 mm", trimWidthMm: 297, trimHeightMm: 210 },
  /** A4 portrait — cheapest to post, best for text-heavy trips. */
  "portrait-a4": { id: "portrait-a4", name: "A4 portrait 210 × 297 mm", trimWidthMm: 210, trimHeightMm: 297 },
};

/**
 * Binding limits, which are a property of the machine and not of taste.
 *
 * These are the numbers each provider publishes for a perfect-bound colour
 * book. **They are written from published documentation and are not verified
 * against a live account** — see docs/providers/photobook.md, which says so in
 * the same words. `verified: false` is carried in the data so nothing can
 * quietly present them as fact.
 */
export type PageCountRule = {
  min: number;
  max: number;
  /** Pages per signature. 4 satisfies every binder; 2 satisfies most. */
  multipleOf: number;
};

export type BindingProfile = PageCountRule & {
  id: string;
  label: string;
  verified: boolean;
  note: string;
};

export const BINDING_PROFILES: Record<string, BindingProfile> = {
  peecho: {
    id: "peecho",
    label: "Peecho / Prodigi — softcover perfect bound",
    min: 20,
    max: 600,
    multipleOf: 2,
    verified: false,
    note: "From Peecho's published product matrix. Confirm against the live product list before ordering.",
  },
  gelato: {
    id: "gelato",
    label: "Gelato — photo book, perfect bound",
    min: 20,
    max: 160,
    multipleOf: 2,
    verified: false,
    note: "Gelato's photo-book products cap far lower than its trade books. Confirm the exact product UID's range.",
  },
  cloudprinter: {
    id: "cloudprinter",
    label: "Cloudprinter — book_softcover_*",
    min: 32,
    max: 800,
    multipleOf: 2,
    verified: false,
    note: "Cloudprinter ranges are per printing partner, not global. The quote API returns the real range.",
  },
  lulu: {
    id: "lulu",
    label: "Lulu — perfect bound, premium colour",
    min: 32,
    max: 800,
    multipleOf: 2,
    verified: false,
    note: "Lulu also ships saddle stitch at 4–48 pages, which suits a short trip better than padding to 32.",
  },
};

/**
 * Saddle stitch — folded and stapled, not glued.
 *
 * Kept out of `BINDING_PROFILES` on purpose: it is not a fifth provider, it is
 * a different *product*, and mixing it into the intersection below would make
 * the portable rule useless for anything longer than a long weekend. It earns
 * its place because a short trip has perhaps fifteen pages of real content, and
 * the alternative to stapling it is seventeen blank leaves at the back.
 */
export const SADDLE_STITCH: BindingProfile = {
  id: "saddle",
  label: "Saddle stitch — folded and stapled (Lulu, and most others)",
  min: 4,
  max: 48,
  multipleOf: 4,
  verified: false,
  note: "The right binding for a trip of a week or two. Lulu publishes 4–48 pages; confirm per provider.",
};

/**
 * The rule that keeps a book printable by all four without re-laying it out.
 *
 * Deliberately the intersection rather than a favourite: choosing a provider
 * is a decision for the day you have an account, and it should not require
 * regenerating the book. `multipleOf: 4` is one step stricter than any of them
 * demands, which costs at most three blank pages and buys saddle stitch as an
 * option for short trips.
 */
export function portableRule(): PageCountRule {
  const profiles = Object.values(BINDING_PROFILES);
  return {
    min: Math.max(...profiles.map((p) => p.min)),
    max: Math.min(...profiles.map((p) => p.max)),
    multipleOf: 4,
  };
}

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

export function defaultSpec(size: BookSize = BOOK_SIZES["square-210"]): BookSpec {
  return {
    size,
    bleedMm: 3,
    safeMm: 10,
    gutterMm: 16,
    dpi: 300,
    paperCaliperMm: 0.115,
    coverBoardMm: 0,
    coverWrapMm: 15,
    pageCount: portableRule(),
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

/** How many pixels wide a photo must be to hit the target DPI at a given
 * printed width. */
export function requiredPixels(widthMm: number, dpi: number): number {
  return Math.ceil((widthMm / 25.4) * dpi);
}

/** The DPI a photo of `pixels` px actually prints at across `widthMm`. */
export function effectiveDpi(pixels: number, widthMm: number): number {
  return widthMm > 0 ? Math.floor((pixels / widthMm) * 25.4) : 0;
}
