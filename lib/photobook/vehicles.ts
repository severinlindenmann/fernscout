import {
  VEHICLE_BOX,
  vehicleShapes,
  type PrintableMode,
} from "../travel/vehicleShapes.ts";
import { paintShapes, strokeWidth, type Place } from "./shapes.ts";
import { SHADOW, type Shape } from "../travellers/shapes.ts";
import { type Page } from "../postcard/pdf.ts";

/**
 * The travel scene's vehicles, on paper — B737.
 *
 * `lib/photobook/travellers.ts` for cars: the geometry is
 * `lib/travel/vehicleShapes.ts` and this file only spells it, once as PDF and
 * once as the preview's SVG. Both spellings walk the same list, so a bus that
 * is wrong in the book is wrong in the composer, which is the only way anybody
 * finds out before it is printed — B740 is the record of what the alternative
 * costs.
 *
 * The vehicle's own colours are used as they are. It is a picture of a bus,
 * not a chart element, so it does not take the book's accent: a yellow bus is
 * yellow in a book whose rules are ochre, the same way a photograph is not
 * tinted to match the page it sits on.
 */

/**
 * Cream, on paper that is already cream.
 *
 * `#fffaf0` is the site's own paper colour, and on screen a cream fuselage
 * sits against a sky. In the book it sits against the page, which is white —
 * so the aeroplane arrived as a fin, two wings and nothing between them, and
 * the boat as a hull with no deckhouse. Looking at it is the only way that
 * was ever going to be found.
 *
 * Substituted here rather than in the geometry, because it is not a
 * disagreement about the drawing: the shape is right and the ink is wrong for
 * this ground. Warm enough to still read as cream, dark enough to hold an
 * edge at the size a book draws a plane.
 */
const CREAM = "#fffaf0";
const CREAM_ON_PAPER = "#efe6d6";

function forPaper(shapes: Shape[]): Shape[] {
  return shapes.map((shape): Shape => {
    if (shape.kind === "group") return { ...shape, shapes: forPaper(shape.shapes) };
    if ("fill" in shape && shape.fill === CREAM) return { ...shape, fill: CREAM_ON_PAPER };
    if ("stroke" in shape && shape.stroke === CREAM) return { ...shape, stroke: CREAM_ON_PAPER };
    return shape;
  });
}

/**
 * Draw one vehicle with its wheels on `yMm`, its left edge at `xMm`.
 *
 * `frame` is the page's own millimetres-to-points mapping, so this reads the
 * same as every other call in `render.ts`: trim-relative millimetres, y
 * upwards. The vehicle's own viewBox has y downwards, which `place` flips —
 * the same arrangement `drawTravellers` uses and for the same reason.
 */
export function drawVehicle(
  page: Page,
  frame: { x: (v: number) => number; y: (v: number) => number },
  mode: PrintableMode,
  xMm: number,
  yMm: number,
  widthMm: number,
): void {
  const box = VEHICLE_BOX[mode];
  const unit = widthMm / box.width;
  const place: Place = (vx, vy) => [frame.x(xMm + vx * unit), frame.y(yMm + (box.height - vy) * unit)];
  paintShapes(page, place, unit, forPaper(vehicleShapes(mode)));
}

/**
 * The same vehicle as an SVG group, for the preview's chart layer.
 *
 * `x` and `y` are already in the chart SVG's own coordinates — millimetres
 * across the page with y downwards, which is what `chartSvg` computes — and
 * `y` is the baseline the wheels stand on, so the group is lifted by its own
 * height.
 */
export function vehicleSvg(mode: PrintableMode, x: string, y: string, widthMm: number): string {
  const box = VEHICLE_BOX[mode];
  const scale = widthMm / box.width;
  const inner = svgShapes(forPaper(vehicleShapes(mode)));
  return (
    `<g transform="translate(${x},${y}) scale(${scale.toFixed(4)}) ` +
    `translate(0,${-box.height})">${inner}</g>`
  );
}

/**
 * `Shape[]` → SVG, in the preview's own dialect.
 *
 * Deliberately not `lib/travellers/render.ts`'s: that one resolves the shadow
 * to a theme-aware CSS variable, and this is evidence about paper. The same
 * split, and the same reasoning, as `travellersSvg`.
 */
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
      if (fillHex) bits.push(`fill="${fillHex === SHADOW ? "#e0e3e6" : fillHex}"`);
      else if (strokeHex) bits.push(`fill="none"`);
      if (strokeHex) {
        bits.push(`stroke="${strokeHex}"`, `stroke-width="${strokeWidth(shape)}"`);
        // Every stroked line in a vehicle is a tube, a fork or a spoke, and
        // all of them end round.
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
