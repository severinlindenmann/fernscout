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
import { figureShapes, SHADOW, type Shape } from "../travellers/shapes.ts";
import { AGE_SCALE, type Figure } from "../travellers/vocabulary.ts";
import { type Page } from "../postcard/pdf.ts";
import { paintShapes, strokeWidth, type Place } from "./shapes.ts";

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
    paintShapes(page, place, unit * scale, figureShapes(placement.figure));
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
  // `cqh`, not `%` — B740.
  //
  // The height used to be a percentage, and every caller positions this
  // absolutely: a percentage height then resolves against a box whose own
  // height is `auto`, which is circular, which is zero. So the figures have
  // been 0 x 0 in the preview since they were added, on the title page and in
  // the colophon both. The PDF drew them all along, which is exactly what
  // made it invisible — nobody looks at one page in both renderers unless
  // they are checking for this.
  //
  // `.sheet` is `container-type:size` (see `previewCss`), so `cqh` is a
  // percentage of the printed page whatever the boxes in between are doing —
  // the same unit the type scale already uses here. Width follows from the
  // viewBox.
  return (
    `<svg viewBox="0 0 ${layout.width.toFixed(2)} ${layout.height.toFixed(2)}" ` +
    `style="height:${heightPct}cqh;display:block" xmlns="http://www.w3.org/2000/svg" ` +
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
