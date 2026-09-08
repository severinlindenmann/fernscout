/**
 * A cover's real shape — back panel, spine, front panel, and for a hardcover
 * case, the wrap around the boards and the two joints either side of the
 * spine.
 *
 * Soft and hard covers are the same `CoverGeometry`: a softcover's `wrapMm`
 * is 0 and its `joint` is absent, so a caller does not need to branch on
 * `spec.cover` to lay one out.
 *
 * Two ways to get one:
 *
 * - `fetchCoverGeometry` asks Gelato's own cover-dimensions endpoint, which
 *   knows the true geometry for a product and a page count. It needs
 *   `GELATO_API_KEY` and never throws — no key, a refusal, or an unreachable
 *   network all answer `null`, so a caller falls back rather than crashing.
 * - `computeCoverGeometry` is the offline fallback (AGENTS.md: no feature
 *   needs a paid account to develop or test), built from constants measured
 *   against the live API on 2026-09-07 (B885). The **hardcover spine is only
 *   two measured points** (56 pages → 6.00 mm, 164 pages → 16.00 mm) linearly
 *   interpolated/extrapolated for every other page count — that is an
 *   approximation, not a fact, and `source: "computed"` says so. **Anything
 *   actually sent to a printer must use `fetchCoverGeometry`'s answer**, not
 *   this one.
 */

import type { BookSpec } from "./spec.ts";

type CoverPanel = { widthMm: number; heightMm: number };

export type CoverGeometry = {
  /** The whole cover as one file: back + joint + spine + joint + front, plus
   * the wrap (0 for softcover) and the bleed, on every edge. */
  sheetWidthMm: number;
  sheetHeightMm: number;
  /** Artwork bleeds this far past the trimmed edge. */
  bleedMm: number;
  /** How far the cover wraps around a hardcover's boards. 0 for softcover. */
  wrapMm: number;
  back: CoverPanel;
  spineWidthMm: number;
  front: CoverPanel;
  /** The hinge either side of the spine. Present only for a hardcover — a
   * softcover has no board to hinge against. Both joints are the same size. */
  joint?: CoverPanel;
  /** A measurement from Gelato's own API, or this module's own estimate. */
  source: "gelato" | "computed";
};

// ---------------------------------------------------------------------------
// Measured constants — see B885 and docs/providers/photobook.md.
// ---------------------------------------------------------------------------

/** Gelato always rounds a page count up by 4 (endpapers, presumably) before
 * it computes a spine. */
function answeredPageCount(pages: number): number {
  return pages + 4;
}

/** `spine = 0.24 + 0.155 * (answeredPages / 2)` reproduces every measured
 * softcover row exactly (28→2.72mm through 200→16.05mm). */
function softcoverSpineMm(pages: number): number {
  return 0.24 + 0.155 * (answeredPageCount(pages) / 2);
}

/**
 * The hardcover spine, measured — because it cannot be computed.
 *
 * A softcover spine is exactly linear in the leaf count and the formula above
 * reproduces every measured row. A hardcover's is not a formula at all. These
 * are Gelato's own answers, in whole millimetres, against page counts it has
 * already rounded up:
 *
 *   32 → 6    44 → 6    56 → 6    60 → 6    72 → 9    84 → 11
 *   96 → 11   104 → 11  108 → 13  132 → 14  156 → 16  164 → 16
 *   180 → 18  204 → 19
 *
 * Six millimetres for everything up to sixty pages, then steps that repeat
 * (84 and 96 are both 11) and jump unevenly (108 → 13, then 132 → 14). That
 * is a table somebody maintains, not a line through two points — and reading
 * it as a line, which this used to, put a 32-page book's spine at 3.78 mm
 * against a real 6.00 mm. A spine 2 mm narrow wraps the front cover image
 * around onto the spine, and it is invisible until the book is in your hands.
 *
 * **This is still the offline fallback, and it is still not the answer.**
 * `fetchCoverGeometry` asks Gelato, and `lib/photobook/build.ts` calls it
 * before anything is rendered for an order. This table is what a checkout
 * with no API key draws with, so that the whole pipeline stays developable
 * without an account — AGENTS.md requires that — and between the measured
 * rows it interpolates and rounds **up**, because too wide merely wastes a
 * millimetre of board and too narrow ruins the cover.
 */
const HARD_SPINE_TABLE: readonly (readonly [pages: number, spineMm: number])[] = [
  [32, 6],
  [44, 6],
  [56, 6],
  [60, 6],
  [72, 9],
  [84, 11],
  [96, 11],
  [104, 11],
  [108, 13],
  [132, 14],
  [156, 16],
  [164, 16],
  [180, 18],
  [204, 19],
];

function hardcoverSpineMmApprox(pages: number): number {
  const p = answeredPageCount(pages);
  const first = HARD_SPINE_TABLE[0];
  const last = HARD_SPINE_TABLE[HARD_SPINE_TABLE.length - 1];
  if (p <= first[0]) return first[1];
  if (p >= last[0]) return last[1];
  for (let i = 1; i < HARD_SPINE_TABLE.length; i++) {
    const [hiPages, hiSpine] = HARD_SPINE_TABLE[i];
    if (p === hiPages) return hiSpine;
    if (p < hiPages) {
      const [loPages, loSpine] = HARD_SPINE_TABLE[i - 1];
      const t = (p - loPages) / (hiPages - loPages);
      return Math.ceil(loSpine + t * (hiSpine - loSpine));
    }
  }
  return last[1];
}

const HARDCOVER_WRAP_MM = 17;
const HARDCOVER_BLEED_MM = 3;
const HARDCOVER_JOINT_MM = 8;

/**
 * The offline fallback. Deterministic, and correct for the sizes and page
 * counts this repository measured — see the module comment for the one place
 * it is a guess rather than a fact.
 */
export function computeCoverGeometry(spec: BookSpec, pageCount: number): CoverGeometry {
  const trimW = spec.size.trimWidthMm;
  const trimH = spec.size.trimHeightMm;

  if (spec.cover === "hard") {
    const spine = hardcoverSpineMmApprox(pageCount);
    const board: CoverPanel = { widthMm: trimW - 2, heightMm: trimH + 6 };
    const contentEdge = HARDCOVER_WRAP_MM + HARDCOVER_BLEED_MM;
    return {
      sheetWidthMm: contentEdge * 2 + board.widthMm * 2 + HARDCOVER_JOINT_MM * 2 + spine,
      sheetHeightMm: board.heightMm + contentEdge * 2,
      bleedMm: HARDCOVER_BLEED_MM,
      wrapMm: HARDCOVER_WRAP_MM,
      back: board,
      spineWidthMm: spine,
      front: board,
      joint: { widthMm: HARDCOVER_JOINT_MM, heightMm: board.heightMm },
      source: "computed",
    };
  }

  const spine = softcoverSpineMm(pageCount);
  const bleed = spec.bleedMm;
  const panel: CoverPanel = { widthMm: trimW, heightMm: trimH };
  return {
    sheetWidthMm: trimW * 2 + spine + bleed * 2,
    sheetHeightMm: trimH + bleed * 2,
    bleedMm: bleed,
    wrapMm: 0,
    back: panel,
    spineWidthMm: spine,
    front: panel,
    source: "computed",
  };
}

// ---------------------------------------------------------------------------
// The live measurement.
// ---------------------------------------------------------------------------

type Box = { width: number; height: number };

function box(value: unknown): Box | null {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { width?: unknown }).width === "number" &&
    typeof (value as { height?: unknown }).height === "number"
  ) {
    return { width: (value as Box).width, height: (value as Box).height };
  }
  return null;
}

/**
 * Asks Gelato's own cover-dimensions endpoint for the true geometry of a
 * product at a page count. Every named box's *size* carries the whole
 * geometry — bleed and wrap are derived arithmetically from how the boxes
 * nest, rather than trusted as a separate field, since deriving them from
 * measurements that were actually returned is more robust than guessing a
 * field name for a value the API may not name at all.
 *
 * Never throws: no `GELATO_API_KEY`, a non-OK response, an unreachable
 * network or a response missing the boxes this needs all answer `null`, so a
 * caller can fall back to `computeCoverGeometry` unconditionally.
 */
export async function fetchCoverGeometry(
  productUid: string,
  pageCount: number,
): Promise<CoverGeometry | null> {
  const key = process.env.GELATO_API_KEY;
  if (!key) return null;
  try {
    const url = `https://product.gelatoapis.com/v3/products/${encodeURIComponent(productUid)}/cover-dimensions?pageCount=${pageCount}&measureUnit=mm`;
    const res = await fetch(url, { headers: { "X-API-KEY": key } });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;

    const contentBack = box(data.contentBackSize);
    const spine = box(data.spineSize);
    const contentFront = box(data.contentFrontSize);
    if (!contentBack || !spine || !contentFront) return null;

    const outer = box(data.wraparoundInsideSize);
    const edge = box(data.wraparoundEdgeSize);
    if (outer && edge) {
      // Hardcover: wrap folds around the board, a joint hinges either side
      // of the spine.
      const jointBack = box(data.jointBackSize);
      const jointFront = box(data.jointFrontSize);
      const jointWidth = jointBack?.width ?? jointFront?.width ?? 0;
      const wrapMm = (outer.width - edge.width) / 2;
      const bleedMm = (edge.width - contentBack.width * 2 - jointWidth * 2 - spine.width) / 2;
      return {
        sheetWidthMm: outer.width,
        sheetHeightMm: outer.height,
        bleedMm,
        wrapMm,
        back: { widthMm: contentBack.width, heightMm: contentBack.height },
        spineWidthMm: spine.width,
        front: { widthMm: contentFront.width, heightMm: contentFront.height },
        joint: jointWidth > 0 ? { widthMm: jointWidth, heightMm: (jointBack ?? jointFront)!.height } : undefined,
        source: "gelato",
      };
    }

    const sheet = box(data.bleedSize);
    if (!sheet) return null;
    return {
      sheetWidthMm: sheet.width,
      sheetHeightMm: sheet.height,
      bleedMm: (sheet.width - contentBack.width * 2 - spine.width) / 2,
      wrapMm: 0,
      back: { widthMm: contentBack.width, heightMm: contentBack.height },
      spineWidthMm: spine.width,
      front: { widthMm: contentFront.width, heightMm: contentFront.height },
      source: "gelato",
    };
  } catch {
    return null;
  }
}
