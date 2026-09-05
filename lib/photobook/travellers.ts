/**
 * The two of us, drawn on paper.
 *
 * `components/Travelers.tsx` draws a pair of figures in SVG and bobs them up
 * and down; they are on the site's travel scene, and they are the closest
 * thing this project has to a mascot. A book of somebody's journey should have
 * the people whose journey it was in it, so they are here too — on the title
 * page and again in the colophon, standing still, because paper does not bob.
 *
 * **The likeness lives in the component.** The path data, the proportions and
 * the palette below are copied from it deliberately rather than shared,
 * because that file is a React client component: importing it here would drag
 * `motion/react` and the whole client runtime into a CLI that writes PDFs.
 * Copying costs a comment saying so — this one — and the two are unlikely to
 * drift, since neither changes without somebody deciding what the pair look
 * like.
 *
 * Two coordinate systems meet here and it is worth being explicit. The
 * component's `viewBox` is 64 wide by 96 tall with **y increasing downwards**,
 * which is how SVG works. PDF has y increasing upwards. `place` below is
 * handed in by the caller and does that flip along with the scaling, so every
 * number in this file can be read straight off the component.
 */

import { PdfBuilder, type Page } from "../postcard/pdf.ts";

type Rgb = { r: number; g: number; b: number };

/** `#rrggbb` → the 0..1 triple the PDF writer wants. */
function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Him: short brown-blond hair. Her: long brown hair. From the component. */
const HIM = {
  skin: rgb("#f7d7bb"),
  hair: rgb("#a67c42"),
  shirt: rgb("#3b82f6"),
  pants: rgb("#37475f"),
  pack: rgb("#f0c05a"),
  longHair: false,
};

const HER = {
  skin: rgb("#f9dcc4"),
  hair: rgb("#6b4423"),
  shirt: rgb("#f472b6"),
  pants: rgb("#3f4a5f"),
  pack: rgb("#5fb08a"),
  longHair: true,
};

const SHOE = rgb("#2b3648");

/** One figure's colours. The shapes are fixed; only the palette varies. */
export type Look = {
  skin: Rgb;
  hair: Rgb;
  shirt: Rgb;
  pants: Rgb;
  pack: Rgb;
  longHair: boolean;
};

/** Maps a point in the component's viewBox to a point on the page. */
export type Place = (vx: number, vy: number) => [number, number];

/** How long one viewBox unit is, in PDF units. Needed for radii, which have
 * no direction and so cannot go through `place`. */
export type Unit = number;

/** The circle-to-bezier constant: four arcs of this length approximate a
 * circle to within a quarter of a percent, which is far below a printer's
 * resolution. */
const K = 0.5523;

/**
 * Which path syntax to emit.
 *
 * PDF and SVG describe the same curves with the same numbers in a different
 * order — `x y m` against `M x y`, `a b c d e f c` against `C a b c d e f`.
 * One geometry with two spellings is the whole of this, and it is why the
 * preview can show the pair without a second copy of them: the preview is the
 * evidence about the printed page, so a mark that appears on one and not the
 * other is the drift this file would otherwise cause.
 */
export type Syntax = "pdf" | "svg";

let syntax: Syntax = "pdf";

function moveTo(place: Place, x: number, y: number): string {
  const [px, py] = place(x, y);
  const [a, b] = [px.toFixed(2), py.toFixed(2)];
  return syntax === "pdf" ? `${a} ${b} m` : `M ${a} ${b}`;
}

function lineTo(place: Place, x: number, y: number): string {
  const [px, py] = place(x, y);
  const [a, b] = [px.toFixed(2), py.toFixed(2)];
  return syntax === "pdf" ? `${a} ${b} l` : `L ${a} ${b}`;
}

function curveTo(
  place: Place,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x: number,
  y: number,
): string {
  const [a, b] = place(c1x, c1y);
  const [c, d] = place(c2x, c2y);
  const [e, f] = place(x, y);
  const n = [a, b, c, d, e, f].map((v) => v.toFixed(2)).join(" ");
  return syntax === "pdf" ? `${n} c` : `C ${n}`;
}

function close(): string {
  return syntax === "pdf" ? "h" : "Z";
}

/**
 * An ellipse, as four bezier arcs.
 *
 * The shadow under each figure and, at equal radii, every round part of them.
 * `PdfBuilder.drawCircle` exists but takes page coordinates and a radius in
 * PDF units, which would mean converting each one at the call site and losing
 * the correspondence with the component that this file is trying to keep.
 */
function ellipse(place: Place, cx: number, cy: number, rx: number, ry: number): string {
  return [
    moveTo(place, cx - rx, cy),
    curveTo(place, cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry),
    curveTo(place, cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy),
    curveTo(place, cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry),
    curveTo(place, cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy),
    close(),
  ].join(" ");
}

/** A rectangle with rounded ends — every limb, and the backpack. */
function roundedRect(
  place: Place,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const radius = Math.min(r, w / 2, h / 2);
  return [
    moveTo(place, x + radius, y),
    lineTo(place, x + w - radius, y),
    curveTo(place, x + w - radius * (1 - K), y, x + w, y + radius * (1 - K), x + w, y + radius),
    lineTo(place, x + w, y + h - radius),
    curveTo(
      place,
      x + w,
      y + h - radius * (1 - K),
      x + w - radius * (1 - K),
      y + h,
      x + w - radius,
      y + h,
    ),
    lineTo(place, x + radius, y + h),
    curveTo(place, x + radius * (1 - K), y + h, x, y + h - radius * (1 - K), x, y + h - radius),
    lineTo(place, x, y + radius),
    curveTo(place, x, y + radius * (1 - K), x + radius * (1 - K), y, x + radius, y),
    close(),
  ].join(" ");
}

/**
 * One figure, in the order the component stacks them: shadow, hair behind the
 * body, backpack, legs, shoes, torso, arms, hands, head, hair in front.
 *
 * Drawing order is the whole of the depth here — there is no z-index in a PDF
 * content stream, only what was painted last.
 */
function person(path: (d: string, fill: Rgb) => void, place: Place, who: Look): void {

  // The ground shadow, at 14% black over paper. Flat grey rather than real
  // transparency: the PDF writer has no alpha, and a soft grey prints the
  // same and keeps the file free of a transparency group (see the PDF/X
  // readiness report, which counts transparency against us).
  path(ellipse(place, 32, 92, 17, 3.5), { r: 0.88, g: 0.89, b: 0.9 });

  if (who.longHair) {
    path(
      [
        moveTo(place, 14, 26),
        // The component writes this as three quadratics; a quadratic is a
        // cubic whose two controls sit two-thirds of the way to the shared
        // control point, which is the conversion applied here and below.
        curveTo(place, 12, 43.33, 12.67, 55.33, 16, 64),
        curveTo(place, 26.67, 67.33, 37.33, 67.33, 48, 64),
        curveTo(place, 51.33, 56, 52, 43.33, 50, 26),
        close(),
      ].join(" "),
      who.hair,
    );
  }

  path(roundedRect(place, 6, 40, 15, 21, 6), who.pack);
  path(roundedRect(place, 21, 64, 9.5, 24, 4.75), who.pants);
  path(roundedRect(place, 33.5, 64, 9.5, 24, 4.75), who.pants);
  path(ellipse(place, 25.5, 89, 6.5, 3.2), SHOE);
  path(ellipse(place, 38.5, 89, 6.5, 3.2), SHOE);

  // Torso: "M17 42 q15 -6 30 0 l2 24 q-17 6 -34 0 z"
  path(
    [
      moveTo(place, 17, 42),
      curveTo(place, 27, 38, 37, 38, 47, 42),
      lineTo(place, 49, 66),
      curveTo(place, 37.67, 70, 26.33, 70, 15, 66),
      close(),
    ].join(" "),
    who.shirt,
  );

  path(roundedRect(place, 11.5, 44, 8, 22, 4), who.shirt);
  path(roundedRect(place, 44.5, 44, 8, 22, 4), who.shirt);
  path(ellipse(place, 15.5, 67, 4.6, 4.6), who.skin);
  path(ellipse(place, 48.5, 67, 4.6, 4.6), who.skin);
  path(ellipse(place, 32, 24, 16, 16), who.skin);
  // The fringe, over the face: a cap of hair across the top of the head.
  path(
    [
      moveTo(place, 16, 22),
      curveTo(place, 17.33, 6.67, 46.67, 6.67, 48, 22),
      curveTo(place, 40, 14, 24, 14, 16, 22),
      close(),
    ].join(" "),
    who.hair,
  );
}

/**
 * Both of them, side by side, fitted into a box on the page.
 *
 * `box` is in whatever units the caller's `place` expects to be handed —
 * `drawPage` works in trim-relative millimetres — and the pair are drawn to
 * fill its height, centred in its width. She is drawn at 95% of his height,
 * as on the site.
 */
export function drawTravellers(
  page: Page,
  toPdf: (xMm: number, yMm: number) => [number, number],
  box: { x: number; y: number; width: number; height: number },
  /**
   * Who to draw, when the trip has said.
   *
   * Defaults to the pair the site has always drawn. A `travellers:` block in
   * `trip.md` is being built separately (see the `describe-a-traveller`
   * skill), and when it lands this is where it arrives: map its looks onto
   * `Look` and pass them in. Until then a book draws the same two figures the
   * website does, which is at least not a new invention — but it is still a
   * guess about who travelled, and the skill's own rule is *ask, never infer*.
   * B497.
   */
  look: Look[] = [HIM, HER],
): void {
  const VIEW_H = 96;
  const VIEW_W = 64;
  const HER_SCALE = 0.95;
  const GAP = 2;

  const unit = box.height / VIEW_H;
  const totalW = (VIEW_W + (look.length - 1) * (VIEW_W * HER_SCALE + GAP)) * unit;
  const left = box.x + (box.width - totalW) / 2;

  /** viewBox → millimetres → PDF, with y flipped: SVG counts downwards and
   * both of the others count up. Standing on the foot of the box. */
  const placeFor = (offsetMm: number, scale: number): Place => {
    return (vx, vy) =>
      toPdf(left + offsetMm + vx * unit * scale, box.y + (VIEW_H - vy) * unit * scale);
  };

  const path = (d: string, fill: Rgb) => PdfBuilder.drawPath(page, d, { fill });
  syntax = "pdf";
  // Everyone after the second is drawn at her scale; two is what the site
  // shows and what every trip so far has had.
  look.forEach((who, i) => {
    const scale = i === 0 ? 1 : HER_SCALE;
    person(path, placeFor(i * (VIEW_W + GAP) * unit, scale), who);
  });
}

/**
 * The same pair, as an `<svg>` element, for the HTML preview.
 *
 * The preview's whole job is to be evidence about the printed page, so a mark
 * that appears on paper and not in the browser is exactly the drift this
 * project keeps having to fix. One geometry, two spellings — see `Syntax`.
 *
 * `heightPct` is a percentage of the page's height, because every other box in
 * the preview is expressed that way.
 */
export function travellersSvg(heightPct: number): string {
  const VIEW_H = 96;
  const VIEW_W = 64;
  const HER_SCALE = 0.95;
  const GAP = 2;
  const totalW = VIEW_W + GAP + VIEW_W * HER_SCALE;

  const shapes: string[] = [];
  const path = (d: string, fill: Rgb) => {
    const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
    shapes.push(`<path d="${d}" fill="#${hex(fill.r)}${hex(fill.g)}${hex(fill.b)}"/>`);
  };
  // SVG counts y downwards, which is the component's own space, so `place` is
  // the identity here apart from her scale and the offset between them.
  const placeFor = (offset: number, scale: number): Place => {
    return (vx, vy) => [offset + vx * scale, vy * scale];
  };

  syntax = "svg";
  person(path, placeFor(0, 1), HIM);
  person(path, placeFor(VIEW_W + GAP, HER_SCALE), HER);
  syntax = "pdf";

  return (
    `<svg viewBox="0 0 ${totalW} ${VIEW_H}" ` +
    `style="height:${heightPct}cqh;width:auto;display:block;overflow:visible">${shapes.join("")}</svg>`
  );
}
