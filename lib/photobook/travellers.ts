/**
 * The people whose journey it is, drawn on paper.
 *
 * A book of somebody's journey should have the people whose journey it was in
 * it, so the site's walking figures are here too — on the title page and again
 * in the colophon, standing still, because paper does not bob.
 *
 * **The geometry is `lib/travellers/shapes.ts`, and this file only spells it
 * as PDF.** It used to carry its own copy of the path data and the palette,
 * with a comment saying the two were "unlikely to drift, since neither changes
 * without somebody deciding what the pair look like". B11 then gave the site
 * eleven hair styles and a `travellers:` block, B498 gave it five outfits, and
 * the book went on printing one particular couple in trousers on the title
 * page of everybody's journey (B497). One geometry, two spellings, now for
 * real.
 *
 * Two coordinate systems meet here. The shapes are in the component's 64×96
 * viewBox with **y increasing downwards**, which is how SVG works. PDF has y
 * increasing upwards. `place` is handed in by the caller and does that flip
 * along with the scaling, so every number in `shapes.ts` can be read straight
 * off the site.
 */

import { arrangeParty } from "../travellers/layout.ts";
import { parsePath } from "../travellers/path.ts";
import { figureShapes, SHADOW, type Shape } from "../travellers/shapes.ts";
import { AGE_SCALE, type Figure } from "../travellers/vocabulary.ts";
import { PdfBuilder, type Page } from "../postcard/pdf.ts";

type Rgb = { r: number; g: number; b: number };

/** `#rrggbb` → the 0..1 triple the PDF writer wants. */
function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/**
 * The ground shadow, at 14% black over paper.
 *
 * Flat grey rather than real transparency: the PDF writer has no alpha, and a
 * soft grey prints the same while keeping the file free of a transparency
 * group — which the PDF/X readiness report counts against us.
 */
const SHADOW_GREY: Rgb = { r: 0.88, g: 0.89, b: 0.9 };

/**
 * A colour with an opacity, flattened against paper.
 *
 * Same reasoning as the shadow, generalised: the site has `opacity` on the
 * shirt yoke, the cheeks, the eye highlights and half the hair detail, and
 * none of it can survive as alpha here. Compositing against white is what a
 * printer would have done anyway for a page whose background is paper.
 */
function flatten(colour: Rgb, opacity: number): Rgb {
  return {
    r: colour.r * opacity + (1 - opacity),
    g: colour.g * opacity + (1 - opacity),
    b: colour.b * opacity + (1 - opacity),
  };
}

/** Maps a point in the component's viewBox to a point on the page. */
export type Place = (vx: number, vy: number) => [number, number];

/** The circle-to-bezier constant: four arcs of this length approximate a
 *  circle to within a quarter of a percent, far below a printer's resolution. */
const K = 0.5522847498307936;

const F = (v: number) => v.toFixed(2);

function moveTo(place: Place, x: number, y: number): string {
  const [a, b] = place(x, y);
  return `${F(a)} ${F(b)} m`;
}

function lineTo(place: Place, x: number, y: number): string {
  const [a, b] = place(x, y);
  return `${F(a)} ${F(b)} l`;
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
  return `${[a, b, c, d, e, f].map(F).join(" ")} c`;
}

/** An ellipse, as four bezier arcs. Every round part of a figure. */
function ellipse(place: Place, cx: number, cy: number, rx: number, ry: number): string {
  return [
    moveTo(place, cx - rx, cy),
    curveTo(place, cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry),
    curveTo(place, cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy),
    curveTo(place, cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry),
    curveTo(place, cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy),
    "h",
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
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (radius === 0) {
    return [
      moveTo(place, x, y),
      lineTo(place, x + w, y),
      lineTo(place, x + w, y + h),
      lineTo(place, x, y + h),
      "h",
    ].join(" ");
  }
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
    "h",
  ].join(" ");
}

/** SVG path data → PDF operators, through the shared converter. */
function pathData(place: Place, d: string): string {
  const out: string[] = [];
  for (const segment of parsePath(d)) {
    switch (segment.op) {
      case "M":
        out.push(moveTo(place, segment.x, segment.y));
        break;
      case "L":
        out.push(lineTo(place, segment.x, segment.y));
        break;
      case "C":
        out.push(
          curveTo(place, segment.x1, segment.y1, segment.x2, segment.y2, segment.x, segment.y),
        );
        break;
      case "Z":
        out.push("h");
        break;
    }
  }
  return out.join(" ");
}

/**
 * Paint one shape onto the page.
 *
 * `place` carries the viewBox → page mapping *and* any enclosing group's
 * horizontal scale, which is how the `build` silhouette survives without PDF
 * needing a transform of its own.
 */
/** A stroke width, for the shapes that can carry one. */
function strokeWidth(shape: Shape): number {
  return shape.kind === "rect" || shape.kind === "group" ? 1 : (shape.width ?? 1);
}

function paint(page: Page, place: Place, unit: number, shape: Shape): void {
  if (shape.kind === "group") {
    // A horizontal scale about a point, folded into `place` rather than
    // emitted as a `cm` matrix: the enclosing `place` may already flip and
    // scale, and composing functions is easier to be sure about than
    // composing matrices with a flip in them.
    const inner: Place = (vx, vy) =>
      place(shape.aboutX + (vx - shape.aboutX) * shape.scaleX, vy);
    for (const child of shape.shapes) paint(page, inner, unit * shape.scaleX, child);
    return;
  }

  const opacity = shape.opacity ?? 1;
  const fillHex = "fill" in shape ? shape.fill : undefined;
  const strokeHex = "stroke" in shape ? shape.stroke : undefined;

  const fill =
    fillHex === undefined
      ? undefined
      : fillHex === SHADOW
        ? SHADOW_GREY
        : flatten(rgb(fillHex), opacity);
  const stroke =
    strokeHex === undefined ? undefined : flatten(rgb(strokeHex), opacity);

  let d: string;
  switch (shape.kind) {
    case "path":
      d = pathData(place, shape.d);
      break;
    case "circle":
      d = ellipse(place, shape.cx, shape.cy, shape.r, shape.r);
      break;
    case "ellipse":
      d = ellipse(place, shape.cx, shape.cy, shape.rx, shape.ry);
      break;
    case "rect":
      d = roundedRect(place, shape.x, shape.y, shape.w, shape.h, shape.r ?? 0);
      break;
  }

  if (!fill && !stroke) return;
  PdfBuilder.drawPath(page, d, {
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke, lineWidth: strokeWidth(shape) * unit } : {}),
  });
}

const VIEW_H = 96;
const VIEW_W = 64;

/**
 * The party, fitted into a box on the page.
 *
 * `box` is in whatever units the caller's `place` expects — `drawPage` works
 * in trim-relative millimetres. The figures are laid out by `arrangeParty`,
 * the same function the website uses, so a family stands in the book the way
 * it stands on the site: children in front, ranks alternating past three, and
 * nobody drawn squarely behind anybody.
 *
 * **An empty party draws nothing at all**, and that is the point rather than
 * an edge case. A book is a keepsake, and printing a placeholder couple on the
 * title page of a trip nobody described is the software asserting who was
 * there. `ask, never infer`, applied to the one artefact somebody keeps.
 */
export function drawTravellers(
  page: Page,
  toPdf: (xMm: number, yMm: number) => [number, number],
  box: { x: number; y: number; width: number; height: number },
  party: Figure[] = [],
): void {
  if (party.length === 0) return;

  // Lay out in viewBox units, then scale the whole composition into the box.
  const layout = arrangeParty(party, VIEW_W);
  const unitsWide = layout.width;
  const unitsTall = layout.height;
  const unit = Math.min(box.height / unitsTall, box.width / unitsWide);
  const left = box.x + (box.width - unitsWide * unit) / 2;

  for (const placement of layout.placements) {
    const scale = placement.scale * AGE_SCALE[placement.figure.age ?? "adult"];
    // Feet on the baseline of the composition, raised by the rank's drop.
    const footY = box.y + placement.bottom * unit;
    const place: Place = (vx, vy) =>
      toPdf(
        left + (placement.x + VIEW_W / 2) * unit + (vx - VIEW_W / 2) * unit * scale,
        footY + (VIEW_H - vy) * unit * scale,
      );
    for (const shape of figureShapes(placement.figure)) {
      paint(page, place, unit * scale, shape);
    }
  }
}

/**
 * The same party as an `<svg>` element, for the HTML preview.
 *
 * The preview's whole job is to be evidence about the printed page, so a mark
 * that appears on paper and not in the browser is exactly the drift this
 * project keeps having to fix. It goes through the same `arrangeParty` and the
 * same shapes; only the spelling differs.
 *
 * `heightPct` is a percentage of the page's height, because every other box in
 * the preview is expressed that way.
 */
export function travellersSvg(heightPct: number, party: Figure[] = []): string {
  if (party.length === 0) return "";
  const layout = arrangeParty(party, VIEW_W);
  const inner = layout.placements
    .map((placement) => {
      const scale = placement.scale * AGE_SCALE[placement.figure.age ?? "adult"];
      const x = placement.x + VIEW_W / 2;
      const y = layout.height - placement.bottom;
      return (
        `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${scale.toFixed(3)}) ` +
        `translate(${-VIEW_W / 2},${-VIEW_H})">${svgShapes(figureShapes(placement.figure))}</g>`
      );
    })
    .join("");
  return (
    `<svg viewBox="0 0 ${layout.width.toFixed(2)} ${layout.height.toFixed(2)}" ` +
    `style="height:${heightPct}%;display:block" xmlns="http://www.w3.org/2000/svg" ` +
    `aria-hidden="true">${inner}</svg>`
  );
}

/** The preview's own SVG spelling. Deliberately not `render.ts`'s: that one
 *  wraps a whole `<svg>` per figure with its own viewBox, and here the figures
 *  share one. The shapes are identical either way. */
function svgShapes(shapes: Shape[]): string {
  return shapes
    .map((shape) => {
      if (shape.kind === "group") {
        return (
          `<g transform="translate(${shape.aboutX},0) scale(${shape.scaleX},1) ` +
          `translate(${-shape.aboutX},0)">${svgShapes(shape.shapes)}</g>`
        );
      }
      const bits: string[] = [];
      const fillHex = "fill" in shape ? shape.fill : undefined;
      const strokeHex = "stroke" in shape ? shape.stroke : undefined;
      // The preview is evidence about paper, so the shadow is the printed grey
      // rather than the site's theme-aware one.
      if (fillHex) bits.push(`fill="${fillHex === SHADOW ? "#e0e3e6" : fillHex}"`);
      else if (strokeHex) bits.push(`fill="none"`);
      if (strokeHex) {
        bits.push(`stroke="${strokeHex}"`, `stroke-width="${strokeWidth(shape)}"`);
        bits.push(`stroke-linecap="round"`);
      }
      if (shape.opacity !== undefined) bits.push(`opacity="${shape.opacity}"`);
      const a = bits.length ? ` ${bits.join(" ")}` : "";
      switch (shape.kind) {
        case "path":
          return `<path d="${shape.d}"${a}/>`;
        case "circle":
          return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}"${a}/>`;
        case "ellipse":
          return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"${a}/>`;
        case "rect":
          return (
            `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}"` +
            `${shape.r ? ` rx="${shape.r}"` : ""}${a}/>`
          );
      }
    })
    .join("");
}
