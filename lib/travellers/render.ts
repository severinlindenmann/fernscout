import { AGE_SCALE, type Figure } from "./vocabulary";
import { figureShapes, SHADOW, type Shape } from "./shapes";

/**
 * A figure in, SVG out. Pure — no React, no DOM, no `fs`, no server-only.
 *
 * The **geometry** is `shapes.ts`; this file only spells it as SVG. That split
 * is what B497 needed: the printed book draws the same travellers in PDF
 * operators, and before the split it did so from a hand-copied second set of
 * path data that had quietly stopped matching. One geometry, two spellings.
 *
 * Three things spell it as SVG through here:
 *
 * - `components/Travelers.tsx` wraps it in `motion` for the walk cycle
 * - `GET /api/v1/<user>/travellers/preview` returns it as `image/svg+xml`
 * - `scripts/travellers.ts` writes a sheet for an agent with no server
 */

/** How a shape's paint reads in SVG. `shadow` is the one indirection: the web
 *  can have a theme-aware translucent grey, and paper cannot. */
function paint(value: string): string {
  return value === SHADOW ? "var(--fig-shadow, rgba(30,41,59,0.15))" : value;
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

function attrs(shape: Extract<Shape, { kind: Exclude<Shape["kind"], "group"> }>): string {
  const out: string[] = [];
  if ("fill" in shape && shape.fill) out.push(`fill="${paint(shape.fill)}"`);
  else if (shape.kind === "path" && shape.stroke) out.push(`fill="none"`);
  if (shape.kind === "path" && shape.stroke) {
    out.push(`stroke="${paint(shape.stroke)}"`);
    out.push(`stroke-width="${n(shape.width ?? 1)}"`);
    out.push(`stroke-linecap="round"`);
  }
  if (shape.opacity !== undefined) out.push(`opacity="${shape.opacity}"`);
  return out.length ? ` ${out.join(" ")}` : "";
}

function toSvg(shapes: Shape[]): string {
  return shapes
    .map((shape) => {
      switch (shape.kind) {
        case "group":
          return (
            `<g transform="translate(${shape.aboutX},0) scale(${shape.scaleX},1) ` +
            `translate(${-shape.aboutX},0)">${toSvg(shape.shapes)}</g>`
          );
        case "path":
          return `<path d="${shape.d}"${attrs(shape)}/>`;
        case "circle":
          return `<circle cx="${n(shape.cx)}" cy="${n(shape.cy)}" r="${n(shape.r)}"${attrs(shape)}/>`;
        case "ellipse":
          return (
            `<ellipse cx="${n(shape.cx)}" cy="${n(shape.cy)}" rx="${n(shape.rx)}" ` +
            `ry="${n(shape.ry)}"${attrs(shape)}/>`
          );
        case "rect":
          return (
            `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.w)}" ` +
            `height="${n(shape.h)}"${shape.r ? ` rx="${n(shape.r)}"` : ""}${attrs(shape)}/>`
          );
      }
    })
    .join("");
}

export type RenderOptions = {
  /** Rendered width in CSS pixels. Height follows from the aspect. */
  width?: number;
  /** `"head"` crops to the head and shoulders — the same drawing, a different
   *  viewBox, which is what the vocabulary swatches use. */
  crop?: "full" | "head";
  /** What a screen reader is told. */
  label?: string;
  /**
   * Hide from assistive technology entirely. What a party of five wants: the
   * container says "five illustrated travellers" once, and five nested
   * `role="img"` elements underneath it would say it again, five times.
   */
  decorative?: boolean;
  /** Extra scale on top of `age`, for a rank standing nearer or further. */
  scale?: number;
  /** Class on the `<svg>` — the component uses it to hang the walk cycle on. */
  className?: string;
  /** Inline style on the `<svg>`, e.g. an `animation-delay`. */
  style?: string;
};

/** The height of a figure rendered at `width`, in the same units. */
export function figureHeight(width: number, crop: "full" | "head" = "full"): number {
  return Math.round(width * (crop === "head" ? 64 / 60 : 1.42));
}

/**
 * The head is a circle of `r=16` in a 64-wide viewBox, so it spans exactly
 * **half** a figure. Everything about how close two figures may stand comes
 * back to this number; see `MIN_STEP` in `layout.ts`.
 */
export const HEAD_WIDTH_RATIO = 32 / 64;

/** One figure, as a complete `<svg>` element. */
export function renderFigure(figure: Figure, options: RenderOptions = {}): string {
  const head = options.crop === "head";
  const width = options.width ?? 76;
  const height = figureHeight(width, head ? "head" : "full");
  const scale = AGE_SCALE[figure.age ?? "adult"] * (options.scale ?? 1);
  const viewBox = head ? "2 -9 60 64" : "-6 -6 76 106";

  const cls = options.className ? ` class="${options.className}"` : "";
  // `overflow: hidden`, not `visible`. Nothing needs to paint outside the
  // viewBox, and `visible` let long hair and braids spill across the labels
  // underneath them in the head crop.
  const inline = options.style ? `overflow:hidden;${options.style}` : "overflow:hidden";
  const described = options.decorative
    ? `aria-hidden="true"`
    : `role="img" aria-label="${escapeAttr(options.label ?? "an illustrated traveller")}"`;

  return (
    `<svg${cls} width="${width}" height="${height}" viewBox="${viewBox}" ` +
    `style="${inline}" xmlns="http://www.w3.org/2000/svg" ${described}>` +
    `<g transform="translate(32,96) scale(${scale}) translate(-32,-96)">` +
    toSvg(figureShapes(figure, { head })) +
    `</g></svg>`
  );
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
