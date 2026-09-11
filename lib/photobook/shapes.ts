/**
 * `Shape[]` → PDF operators.
 *
 * The spelling half of `lib/travellers/shapes.ts`, moved here in B737 when a
 * second thing wanted it: the figures were the only drawing the book had, and
 * now the vehicles are drawn from the same primitives. `lib/travellers/render.ts`
 * is the other spelling of the same shapes, as SVG, for the browser and for
 * the composer's preview.
 *
 * Two coordinate systems meet here. The shapes are written in a component's
 * viewBox with **y increasing downwards**, which is how SVG works; PDF has y
 * increasing upwards. `Place` is handed in by the caller and does that flip
 * along with the scaling, so every number in a shapes file can be read
 * straight off the site.
 *
 * No alpha and no gradients: `lib/postcard/pdf.ts` has neither, and a
 * transparency group is the first thing a PDF/X preflight counts against us.
 * `flatten` composites against paper instead, which is what a printer would
 * have done anyway for a page whose background is white.
 */

import { parsePath } from "../travellers/path.ts";
import { SHADOW, type Shape } from "../travellers/shapes.ts";
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
export function strokeWidth(shape: Shape): number {
  return shape.kind === "group" ? 1 : (shape.width ?? 1);
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

/** Paint a whole list, in order. The one entry point callers want. */
export function paintShapes(page: Page, place: Place, unit: number, shapes: Shape[]): void {
  for (const shape of shapes) paint(page, place, unit, shape);
}
